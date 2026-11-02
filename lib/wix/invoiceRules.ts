/**
 * Pure Wix invoice rules. No network and no database.
 * The saved work order number is only the display number Wix returns.
 */

import { validateVinForModelYear, VIN_CHARSET, normalizeVin } from "@/lib/vin/validate";

export const HST_LINE_PATTERN = /^\s*hst\b/i;
export const LEGAL_ENTITY_NAME = "OTOMOTO TORONTO MOTO INC.";
export const ONTARIO_HST_RATE = "0.13";

const SEALED_STATUSES = new Set(["PAID", "VOIDED", "CANCELED", "CLOSED"]);
const LINE_SYNC_STATUSES = new Set(["DRAFT", "PUBLISHED", "PARTIALLY_PAID"]);

export function invoiceInteger(value: string | null | undefined): number | null {
  const trimmed = value?.trim() ?? "";
  if (!/^\d+$/.test(trimmed)) return null;
  const digits = trimmed.replace(/^0+/, "") || "0";
  if (digits.length > 12) return null;
  const parsed = Number(digits);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

/** Digit-only search. `389`, `03894`, and `0003894` compare as integers. */
export function isInvoiceIntegerQuery(query: string): boolean {
  return /^\d+$/.test(query.trim());
}

export function invoiceNumbersEqual(
  query: string | null | undefined,
  displayNumber: string | null | undefined
): boolean {
  const left = invoiceInteger(query);
  const right = invoiceInteger(displayNumber);
  if (left == null || right == null) return false;
  return left === right;
}

/**
 * Preview only. The saved number is numbering.displayNumber from create.
 * Padding follows the sample (`0003894` → width 7). No sample means no padding.
 */
export function formatPreviewDisplayNumber(
  latestNumber: number,
  sampleDisplayNumber: string | null | undefined
): string {
  const next = Math.max(0, Math.trunc(latestNumber)) + 1;
  const sample = sampleDisplayNumber?.trim() ?? "";
  const width = /^\d+$/.test(sample) ? sample.length : 0;
  const raw = String(next);
  return width > raw.length ? raw.padStart(width, "0") : raw;
}

const WIX_INVOICE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isWixInvoiceId(value: string | null | undefined): boolean {
  return WIX_INVOICE_ID.test(value?.trim() ?? "");
}

export function shouldIgnoreIncomingRevision(
  storedRevision: string | null | undefined,
  incomingRevision: string | null | undefined
): boolean {
  if (!storedRevision?.trim() || !incomingRevision?.trim()) return false;
  const stored = Number(storedRevision);
  const incoming = Number(incomingRevision);
  if (Number.isFinite(stored) && Number.isFinite(incoming)) {
    return incoming <= stored;
  }
  return incomingRevision.trim() === storedRevision.trim();
}

export function canSyncInvoiceLines(status: string | null | undefined): boolean {
  return LINE_SYNC_STATUSES.has((status ?? "").toUpperCase());
}

export function invoiceIsSealed(status: string | null | undefined): boolean {
  return SEALED_STATUSES.has((status ?? "").toUpperCase());
}

/** Customer profile edits update a draft or a published invoice that is still unpaid. */
export function canSyncCustomerBlock(status: string | null | undefined): boolean {
  const normalized = (status ?? "").toUpperCase();
  return normalized === "DRAFT" || normalized === "PUBLISHED";
}

/**
 * Wix assigns numbering.displayNumber when a draft is published.
 * A draft with no number still needs that publish. Sending the email is separate.
 */
export function draftNeedsNumberAllocation(input: {
  status?: string | null;
  displayNumber?: string | null;
}): boolean {
  if (input.displayNumber?.trim()) return false;
  const status = (input.status ?? "DRAFT").toUpperCase();
  return status === "DRAFT" || status === "";
}

export function isVoidStatus(status: string | null | undefined): boolean {
  return (status ?? "").toUpperCase() === "VOIDED";
}

export function wixStatusLabel(
  status: string | null | undefined,
  qualifiers: readonly string[] = []
): string {
  const normalized = (status ?? "").toUpperCase();
  const flags = qualifiers.map((item) => item.toUpperCase());
  if (
    flags.includes("OVERDUE") &&
    normalized !== "PAID" &&
    normalized !== "VOIDED"
  ) {
    return "Overdue";
  }
  switch (normalized) {
    case "DRAFT":
      return "Draft";
    case "PUBLISHING":
      return "Publishing";
    case "PUBLISHED":
      return "Published";
    case "PARTIALLY_PAID":
      return "Partially paid";
    case "PAID":
      return "Paid";
    case "VOIDED":
      return "Voided";
    default:
      return status?.trim() || "Unknown";
  }
}

export function invoiceTitle(year: number, make: string, model: string): string {
  return `${year} ${make} ${model}`.replace(/\s+/g, " ").trim().slice(0, 200);
}

export type HeaderField = { title: string; value: string };

/** Header holds the bike. Technician name uses a business custom field (header max is 4). */
export function bikeHeaderFields(input: {
  vin: string;
  plate: string;
  colour: string;
  mileage: string;
}): HeaderField[] {
  return [
    { title: "VIN", value: input.vin.slice(0, 100) },
    { title: "Plate", value: input.plate.slice(0, 100) },
    { title: "Colour", value: input.colour.slice(0, 100) },
    { title: "Mileage", value: input.mileage.slice(0, 100) },
  ];
}

export type PreTaxLine = { name: string; price: number; quantity?: number };

/** Shop prices are pre-tax. Wix adds Ontario HST. Never send an HST line. */
export function preTaxLineItems(lines: PreTaxLine[]): PreTaxLine[] {
  return lines
    .filter((line) => !HST_LINE_PATTERN.test(line.name))
    .map((line) => ({
      name: line.name.trim().slice(0, 200) || "Service",
      price: Number.isFinite(line.price) && line.price > 0 ? roundMoney(line.price) : 0,
      quantity: line.quantity && line.quantity > 0 ? line.quantity : 1,
    }));
}

export function moneyToCents(amount: string | number | null | undefined): number {
  if (amount == null || amount === "") return 0;
  const value = typeof amount === "number" ? amount : Number(amount);
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100);
}

export function centsToMoney(cents: number): string {
  return (Math.round(cents) / 100).toFixed(2);
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

export function isPayPalMethod(method: string | null | undefined): boolean {
  return (method ?? "").trim().toLowerCase() === "paypal";
}

export type SquareDecision =
  | { action: "auto_square" }
  | { action: "ask" }
  | { action: "skip_void" }
  | { action: "skip_excluded" }
  | { action: "already_squared" };

export function squareDecision(input: {
  method: string;
  voided: boolean;
  excludeFromSquare: boolean;
  alreadySquared: boolean;
}): SquareDecision {
  if (input.voided) return { action: "skip_void" };
  if (input.excludeFromSquare) return { action: "skip_excluded" };
  if (input.alreadySquared) return { action: "already_squared" };
  if (isPayPalMethod(input.method)) return { action: "auto_square" };
  return { action: "ask" };
}

/** Square idempotency key is the Wix payment id (or the chosen Square payment id). */
export function squareIdempotencyKey(sourceId: string): string {
  const trimmed = sourceId.trim();
  if (!trimmed) throw new Error("SQUARE_IDEMPOTENCY_REQUIRED");
  return trimmed.slice(0, 45);
}

export function squareRecordName(clientName: string, displayNumber: string): string {
  return `${clientName.trim()} ${displayNumber.trim()}`.replace(/\s+/g, " ").trim().slice(0, 255);
}

/**
 * A date-only value is the Toronto calendar day staff picked.
 * 16:00 UTC stays on that day in both EST and EDT.
 * A full timestamp keeps its calendar date the same way.
 */
export function shopDueDateIso(value: string | null | undefined, fallbackIso: string): string {
  const trimmed = value?.trim() ?? "";
  const dateOnly = trimmed.match(/^(\d{4}-\d{2}-\d{2})/);
  if (dateOnly) return `${dateOnly[1]}T16:00:00.000Z`;
  return fallbackIso;
}

/** Terminal amount wins. Offline cash, e-transfer, and cheque use the typed amount. */
export function recordedCentsForVisit(input: {
  terminalAmountCents: number | null;
  offlineAmountCents: number | null;
}): number {
  if (input.terminalAmountCents != null && input.terminalAmountCents > 0) {
    return Math.round(input.terminalAmountCents);
  }
  if (input.offlineAmountCents != null && input.offlineAmountCents > 0) {
    return Math.round(input.offlineAmountCents);
  }
  throw new Error("SQUARE_AMOUNT_REQUIRED");
}

/**
 * Squared when Square's total equals what Wix collected.
 * After a void, Square's total equals the amount staff recorded.
 */
export function visitIsSquared(input: {
  voided: boolean;
  wixCollectedCents: number;
  squareRecordedCents: number;
  staffRecordedCents: number;
}): boolean {
  const target = input.voided ? input.staffRecordedCents : input.wixCollectedCents;
  return target > 0 && input.squareRecordedCents === target;
}

export function acknowledgementClearedOnSuccess(input: {
  retrySucceeded: boolean;
}): boolean {
  return input.retrySucceeded;
}

/**
 * Shown in the red form error during the appId outage. A successful
 * acknowledge is a status, and the next create has to run from the same tap.
 */
export const ACKNOWLEDGED_INTAKE_SUCCESS = "Acknowledged. Try again to create the invoice.";

export function intakeBannerMessage(input: {
  error: string | null;
  notice: string | null;
}): { error: string | null; notice: string | null } {
  if (input.error === ACKNOWLEDGED_INTAKE_SUCCESS) {
    return { error: null, notice: input.notice ?? ACKNOWLEDGED_INTAKE_SUCCESS };
  }
  return { error: input.error, notice: input.notice };
}

/**
 * Get Paid Invoices (`POST /invoices/v4/invoices`) are the only REST create
 * that returns `numbering.displayNumber`. Wix documents HTTP 428 until it
 * migrates the site, and says the legacy service is Velo-only
 * (`wix-billing-backend`). That module returns an invoice id, not
 * `numbering.displayNumber`, and it is not a REST method.
 */
export function isLegacyInvoicesApiUnavailable(reason: string): boolean {
  const text = reason.toLowerCase();
  return (
    text.includes("legacy invoices service") ||
    text.includes("only accessible through velo") ||
    text.includes("isn't available on this site yet") ||
    text.includes("is not available on this site yet") ||
    text.includes("new invoices api isn't available") ||
    text.includes("new invoices api is not available")
  );
}

/**
 * A failed retry replaces the stored error and clears the previous
 * acknowledge. `hold_revision` moves forward so a late Acknowledge for the
 * error staff already saw cannot stamp the new one.
 */
export function acknowledgementFieldsOnFailedRetry(input: {
  holdRevision: number;
}): { acknowledged_at: null; hold_revision: number } {
  const current = Number.isFinite(input.holdRevision) ? Math.trunc(input.holdRevision) : 1;
  return {
    acknowledged_at: null,
    hold_revision: Math.max(1, current) + 1,
  };
}

export function shouldApplyInvoiceAcknowledgement(input: {
  storedRevision: number;
  seenRevision: number;
  storedErrorText: string;
  seenErrorText: string;
  cleared: boolean;
  alreadyAcknowledged: boolean;
}): boolean {
  if (input.cleared || input.alreadyAcknowledged) return false;
  if (input.storedRevision !== input.seenRevision) return false;
  return input.storedErrorText === input.seenErrorText;
}

const VIN_TOKEN = /\b[A-HJ-NPR-Z0-9]{5,17}\b/g;

export function extractVinCandidates(text: string): string[] {
  const found = new Set<string>();
  const source = text.toUpperCase();
  for (const match of source.matchAll(VIN_TOKEN)) {
    const token = normalizeVin(match[0]);
    if (VIN_CHARSET.test(token)) found.add(token);
  }
  return [...found];
}

/**
 * A VIN counts when it passes the year rule. Year is unknown for historical
 * text, so 17-character tokens count and shorter tokens count only when a
 * model year of 1990 or earlier is known.
 */
export function vinsFromInvoiceText(
  text: string,
  modelYear: number | null = null
): string[] {
  return extractVinCandidates(text).filter((token) => {
    if (token.length === 17) return validateVinForModelYear(token, modelYear ?? 2000).ok;
    if (modelYear != null && modelYear <= 1990) {
      return validateVinForModelYear(token, modelYear).ok;
    }
    return false;
  });
}

export type IntakeReadiness =
  | { ok: true }
  | { ok: false; code: string; message: string };

export function assertIntakeInvoiceReady(input: {
  clientName: string;
  phone: string | null;
  email: string | null;
  year: number;
  make: string;
  model: string;
  colour: string | null;
  plate: string | null;
  vin: string | null;
}): IntakeReadiness {
  const bike = `${input.year} ${input.make} ${input.model}`.trim();
  const client = input.clientName.trim() || "this client";
  if (!input.phone?.trim() && !input.email?.trim()) {
    return {
      ok: false,
      code: "CONTACT_REQUIRED",
      message: `${client} on ${bike} needs a phone number or an email before a Wix invoice can be created.`,
    };
  }
  if (!input.colour?.trim()) {
    return {
      ok: false,
      code: "COLOUR_REQUIRED",
      message: `${client} on ${bike}: colour is required on the Wix invoice.`,
    };
  }
  if (!input.plate?.trim()) {
    return {
      ok: false,
      code: "PLATE_REQUIRED",
      message: `${client} on ${bike}: enter a plate or N/A.`,
    };
  }
  const vin = validateVinForModelYear(input.vin ?? "", input.year);
  if (!vin.ok) {
    return {
      ok: false,
      code: "VIN_REQUIRED",
      message: `${client} on ${bike}: ${vin.error}`,
    };
  }
  return { ok: true };
}

export function intakeFailureMessage(input: {
  clientName: string;
  bikeLabel: string;
  wixReason: string;
}): string {
  const client = input.clientName.trim();
  const bike = input.bikeLabel.trim();
  const reason = input.wixReason.trim();
  if (isLegacyInvoicesApiUnavailable(reason)) {
    return `Wix is still rolling the new Invoices API out to this site. The work order number for ${client} on ${bike} will come from that API when the rollout reaches this site. Tap Try again to check. No work order number was created.`;
  }
  return `Wix did not return an invoice number for ${client} on ${bike}. ${reason} Acknowledge this before trying again. No work order number was created.`;
}
