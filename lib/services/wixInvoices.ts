import "server-only";

import { randomUUID } from "node:crypto";
import { createAdminClient } from "@/lib/database/supabase-admin";
import { requireUser } from "@/lib/auth/session";
import {
  canCreateWorkOrder,
  canRecordCustomerApproval,
  canViewPricing,
} from "@/lib/permissions/checks";
import { wixInvoicesEnabled } from "@/lib/config/features";
import { getWixContactsConfig } from "@/lib/wix/config";
import {
  createWixInvoice,
  getLatestInvoiceNumber,
  getWixInvoice,
  initiateWixInvoicePayment,
  publishWixInvoice,
  queryWixInvoices,
  sendWixInvoice,
  updateWixInvoice,
  voidWixInvoice,
  WixInvoiceApiError,
} from "@/lib/wix/invoiceClient";
import {
  buildDraftInvoiceBody,
  buildLineUpdate,
  draftHasDisplayNumber,
  headerValue,
  paymentCents,
  paymentMethod,
  payUrlFromInvoice,
  totalsCents,
  vinsOnInvoice,
  type WixInvoiceRecord,
} from "@/lib/wix/invoicePayload";
import {
  acknowledgementClearedOnSuccess,
  acknowledgementFieldsOnFailedRetry,
  assertIntakeInvoiceReady,
  bikeHeaderFields,
  canSyncCustomerBlock,
  canSyncInvoiceLines,
  draftNeedsNumberAllocation,
  formatPreviewDisplayNumber,
  intakeFailureMessage,
  isLegacyInvoicesApiUnavailable,
  shouldApplyInvoiceAcknowledgement,
  invoiceInteger,
  invoiceIsSealed,
  isWixInvoiceId,
  invoiceTitle,
  isVoidStatus,
  recordedCentsForVisit,
  shopDueDateIso,
  shouldIgnoreIncomingRevision,
  squareDecision,
  squareIdempotencyKey,
  squareRecordName,
  wixStatusLabel,
} from "@/lib/wix/invoiceRules";
import { syncCustomerToWix } from "@/lib/services/wixContacts";
import {
  createSquareExternalPayment,
  listRecentSquarePayments,
  refundSquarePayment,
  type SquarePaymentListItem,
} from "@/lib/square/client";

type Admin = ReturnType<typeof createAdminClient>;

export class WixIntakeBlockedError extends Error {
  readonly acknowledgementId: string;
  readonly holdRevision: number;
  constructor(message: string, acknowledgementId: string, holdRevision: number) {
    super(message);
    this.name = "WixIntakeBlockedError";
    this.acknowledgementId = acknowledgementId;
    this.holdRevision = holdRevision;
  }
}

export type WixInvoiceListItem = {
  wix_invoice_id: string;
  display_number: string;
  status_label: string;
  total_cents: number;
  issue_date: string | null;
  vin_snapshot: string | null;
  voided: boolean;
  work_order_id: string | null;
  customer_id: string | null;
};

export type PreparedIntake = {
  displayNumber: string;
  wixInvoiceId: string;
  workOrderId: string;
  replacesBookingStub: boolean;
};

function adminOrNull(): Admin | null {
  try {
    return createAdminClient();
  } catch {
    return null;
  }
}

function shopTodayIso(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  return `${year}-${month}-${day}T16:00:00.000Z`;
}

export async function previewNextDisplayNumber(): Promise<string | null> {
  if (!wixInvoicesEnabled()) return null;
  const latest = await getLatestInvoiceNumber();
  let sample: string | null = null;
  try {
    const page = await queryWixInvoices({}, 1);
    sample = page.invoices[0]?.numbering?.displayNumber ?? null;
  } catch {
    sample = null;
  }
  return formatPreviewDisplayNumber(latest, sample);
}

async function creditCentsForCustomer(admin: Admin, customerId: string): Promise<number> {
  const { data } = await admin
    .from("customer_credit")
    .select("remaining_amount")
    .eq("customer_id", customerId)
    .gt("remaining_amount", 0);
  const dollars = (data ?? []).reduce(
    (sum: number, row: { remaining_amount?: number | string | null }) =>
      sum + Number(row.remaining_amount ?? 0),
    0
  );
  return Math.max(0, Math.round(dollars * 100));
}

/** Remaining credit plus the amount already reserved on this invoice. */
async function creditCentsForOpenInvoice(
  admin: Admin,
  customerId: string,
  wixInvoiceId: string | null
): Promise<number> {
  const remaining = await creditCentsForCustomer(admin, customerId);
  if (!wixInvoiceId) return remaining;
  const { data } = await admin
    .from("wix_invoice")
    .select("credit_applied_cents")
    .eq("wix_invoice_id", wixInvoiceId)
    .maybeSingle();
  return remaining + Number(data?.credit_applied_cents ?? 0);
}

/** Keep the discount on later edits, and stop the next invoice from applying it again. */
async function reserveCustomerCredit(
  admin: Admin,
  customerId: string,
  wixInvoiceId: string,
  targetCents: number
): Promise<void> {
  if (targetCents <= 0) return;
  const { data: row } = await admin
    .from("wix_invoice")
    .select("credit_applied_cents")
    .eq("wix_invoice_id", wixInvoiceId)
    .maybeSingle();
  const applied = Number(row?.credit_applied_cents ?? 0);
  const delta = targetCents - applied;
  if (delta <= 0) return;
  const { data: credits } = await admin
    .from("customer_credit")
    .select("credit_id, remaining_amount")
    .eq("customer_id", customerId)
    .gt("remaining_amount", 0)
    .order("created_at", { ascending: true });
  let left = delta;
  for (const credit of credits ?? []) {
    if (left <= 0) break;
    const remainingCents = Math.round(Number(credit.remaining_amount ?? 0) * 100);
    const take = Math.min(remainingCents, left);
    await admin
      .from("customer_credit")
      .update({ remaining_amount: (remainingCents - take) / 100 })
      .eq("credit_id", credit.credit_id);
    left -= take;
  }
  await admin
    .from("wix_invoice")
    .update({ credit_applied_cents: targetCents - left })
    .eq("wix_invoice_id", wixInvoiceId);
}

async function findMotorcycleByVin(admin: Admin, vin: string): Promise<string | null> {
  const { data } = await admin
    .from("motorcycle")
    .select("motorcycle_id")
    .eq("vin", vin)
    .limit(2);
  if (!data || data.length !== 1) return null;
  return data[0].motorcycle_id as string;
}

async function findWorkOrderByDisplayNumber(
  admin: Admin,
  displayNumber: string
): Promise<string | null> {
  const { data } = await admin
    .from("work_order")
    .select("work_order_id")
    .eq("work_order_number", displayNumber)
    .limit(2);
  if (!data || data.length !== 1) return null;
  return data[0].work_order_id as string;
}

export async function upsertInvoiceFromRecord(
  invoice: WixInvoiceRecord,
  options: { excludeFromSquare?: boolean; createCustomer?: boolean } = {}
): Promise<{ ignored: boolean }> {
  const admin = createAdminClient();
  const wixId = invoice.id?.trim();
  const displayNumber = invoice.numbering?.displayNumber?.trim() ?? "";
  const number = invoice.numbering?.number ?? invoiceInteger(displayNumber);
  if (!wixId || !displayNumber || number == null) {
    return { ignored: true };
  }

  const { data: existing } = await admin
    .from("wix_invoice")
    .select("revision, status, voided, vin_snapshot, motorcycle_id, exclude_from_square, customer_id")
    .eq("wix_invoice_id", wixId)
    .maybeSingle();

  if (
    existing &&
    shouldIgnoreIncomingRevision(existing.revision as string, invoice.revision ?? null)
  ) {
    return { ignored: true };
  }

  const sealed = existing
    ? (existing.status as string) === "PAID" || Boolean(existing.voided)
    : false;
  const textVins = vinsOnInvoice(invoice);
  const headerVin = headerValue(invoice, "VIN");
  const nextVin = headerVin || textVins[0] || null;
  const vinSnapshot = sealed ? ((existing?.vin_snapshot as string | null) ?? nextVin) : nextVin;
  const motorcycleId = sealed
    ? ((existing?.motorcycle_id as string | null) ?? null)
    : vinSnapshot
      ? await findMotorcycleByVin(admin, vinSnapshot)
      : null;

  const contactId = invoice.customerInfo?.contactId ?? null;
  let customerId = (existing?.customer_id as string | null) ?? null;
  if (contactId) {
    const { data: match } = await admin
      .from("customer")
      .select("customer_id")
      .eq("wix_contact_id", contactId)
      .limit(1)
      .maybeSingle();
    if (match?.customer_id) customerId = match.customer_id as string;
    else if (options.createCustomer && !customerId) {
      customerId = await createCustomerFromInvoice(admin, invoice);
    }
  }

  const linkedWorkOrder =
    (await findWorkOrderByDisplayNumber(admin, displayNumber)) ?? null;
  const totals = totalsCents(invoice);
  const voided = isVoidStatus(invoice.status);
  const exclude =
    Boolean(options.excludeFromSquare) ||
    Boolean(existing?.exclude_from_square) ||
    (invoice.status ?? "").toUpperCase() === "PAID" && Boolean(options.excludeFromSquare);

  const row = {
    wix_invoice_id: wixId,
    revision: String(invoice.revision ?? "1"),
    display_number: displayNumber,
    invoice_number: number,
    status: invoice.status ?? "DRAFT",
    status_qualifiers: invoice.statusQualifiers ?? [],
    total_cents: totals.total,
    paid_cents: totals.paid,
    currency: invoice.currency ?? "CAD",
    issue_date: invoice.issueDate ?? null,
    due_date: invoice.dueDate ?? null,
    customer_id: customerId,
    motorcycle_id: motorcycleId,
    vin_snapshot: vinSnapshot,
    work_order_id: linkedWorkOrder,
    voided,
    title: invoice.title ?? null,
    contact_id: contactId,
    pay_url: payUrlFromInvoice(invoice),
    exclude_from_square: exclude || Boolean(existing?.exclude_from_square),
    updated_at: new Date().toISOString(),
  };

  const { error } = await admin.from("wix_invoice").upsert(row, { onConflict: "wix_invoice_id" });
  if (error) throw error;

  await syncPaymentRows(admin, wixId, invoice, {
    voided,
    excludeFromSquare: Boolean(row.exclude_from_square),
    clientName: clientNameFromInvoice(invoice),
    displayNumber,
  });

  if ((invoice.status ?? "").toUpperCase() === "DRAFT") {
    await applyDraftPricesToJobs(admin, linkedWorkOrder, invoice);
  }

  return { ignored: false };
}

function clientNameFromInvoice(invoice: WixInvoiceRecord): string {
  const details = invoice.customerInfo?.contactDetails;
  return `${details?.firstName ?? ""} ${details?.lastName ?? ""}`.trim() || "Client";
}

async function createCustomerFromInvoice(
  admin: Admin,
  invoice: WixInvoiceRecord
): Promise<string | null> {
  const details = invoice.customerInfo?.contactDetails;
  const first = details?.firstName?.trim() || "Wix";
  const last = details?.lastName?.trim() || "Contact";
  const email = (details as { email?: string } | undefined)?.email?.trim() || null;
  const phone = (details as { phone?: string } | undefined)?.phone?.trim() || null;
  if (!email && !phone) return null;
  const { data, error } = await admin
    .from("customer")
    .insert({
      first_name: first,
      last_name: last,
      email,
      phone,
      wix_contact_id: invoice.customerInfo?.contactId ?? null,
      account_type: "retail",
    })
    .select("customer_id")
    .single();
  if (error) return null;
  return (data?.customer_id as string) ?? null;
}

async function syncPaymentRows(
  admin: Admin,
  wixInvoiceId: string,
  invoice: WixInvoiceRecord,
  context: {
    voided: boolean;
    excludeFromSquare: boolean;
    clientName: string;
    displayNumber: string;
  }
): Promise<void> {
  for (const payment of invoice.payments ?? []) {
    const paymentId = payment.id?.trim();
    if (!paymentId) continue;
    const method = paymentMethod(payment);
    const { data: existing } = await admin
      .from("wix_invoice_payment")
      .select("square_status, square_payment_id")
      .eq("wix_payment_id", paymentId)
      .maybeSingle();
    const already = existing?.square_status === "squared";
    const decision = squareDecision({
      method,
      voided: context.voided,
      excludeFromSquare: context.excludeFromSquare,
      alreadySquared: already,
    });
    let squareStatus = (existing?.square_status as string) ?? "unasked";
    if (decision.action === "skip_void" || decision.action === "skip_excluded") {
      squareStatus = "skipped_void";
    } else if (decision.action === "already_squared") {
      squareStatus = "squared";
    } else if (!existing) {
      squareStatus = "unasked";
    }
    await admin.from("wix_invoice_payment").upsert(
      {
        wix_payment_id: paymentId,
        wix_invoice_id: wixInvoiceId,
        amount_cents: paymentCents(payment),
        method,
        kind: "payment",
        square_status: squareStatus,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "wix_payment_id" }
    );

    const refunded = payment.regularPayment?.paymentStatus === "REFUNDED" ||
      payment.regularPayment?.paymentStatus === "PARTIALLY_REFUNDED";
    if (refunded) {
      const refundId = `${paymentId}:refund`;
      const { data: refundRow } = await admin
        .from("wix_invoice_payment")
        .select("square_status")
        .eq("wix_payment_id", refundId)
        .maybeSingle();
      if (!refundRow) {
        await admin.from("wix_invoice_payment").insert({
          wix_payment_id: refundId,
          wix_invoice_id: wixInvoiceId,
          amount_cents: paymentCents(payment),
          method,
          kind: "refund",
          square_status: context.voided || context.excludeFromSquare ? "skipped_void" : "unasked",
          square_payment_id: (existing?.square_payment_id as string | null) ?? null,
        });
      }
    }

    if (decision.action === "auto_square") {
      await squarePaymentRow(admin, paymentId, context.clientName, context.displayNumber);
    }
  }
}

async function applyDraftPricesToJobs(
  admin: Admin,
  workOrderId: string | null,
  invoice: WixInvoiceRecord
): Promise<void> {
  if (!workOrderId || !canSyncInvoiceLines("DRAFT")) return;
  const { data: jobs } = await admin
    .from("job")
    .select("job_id, service_name_snapshot, standard_price_snapshot")
    .eq("work_order_id", workOrderId);
  for (const job of jobs ?? []) {
    const line = (invoice.lineItems ?? []).find(
      (item) => item.customItem?.name?.trim() === String(job.service_name_snapshot ?? "").trim()
    );
    if (!line?.customItem?.price) continue;
    const price = Number(line.customItem.price);
    if (!Number.isFinite(price)) continue;
    if (Number(job.standard_price_snapshot) === price) continue;
    await admin.from("job").update({ standard_price_snapshot: price }).eq("job_id", job.job_id);
  }
}

export async function deleteInvoiceLocally(wixInvoiceId: string): Promise<void> {
  const admin = createAdminClient();
  await admin.from("wix_invoice").delete().eq("wix_invoice_id", wixInvoiceId);
}

export async function listInvoicesForCustomer(customerId: string): Promise<WixInvoiceListItem[]> {
  const user = await requireUser();
  if (!canViewPricing(user.role)) return [];
  const admin = adminOrNull();
  if (!admin) return [];
  const { data, error } = await admin
    .from("wix_invoice")
    .select(
      "wix_invoice_id, display_number, status, status_qualifiers, total_cents, issue_date, vin_snapshot, voided, work_order_id, customer_id"
    )
    .eq("customer_id", customerId)
    .order("invoice_number", { ascending: false });
  if (error) return [];
  return (data ?? []).map(toListItem);
}

export async function listInvoicesForMotorcycle(motorcycleId: string): Promise<WixInvoiceListItem[]> {
  const user = await requireUser();
  if (!canViewPricing(user.role)) return [];
  const admin = adminOrNull();
  if (!admin) return [];
  const { data: bike } = await admin
    .from("motorcycle")
    .select("vin")
    .eq("motorcycle_id", motorcycleId)
    .maybeSingle();
  const vin = (bike?.vin as string | null)?.trim();
  if (!vin) return [];
  const { data, error } = await admin
    .from("wix_invoice")
    .select(
      "wix_invoice_id, display_number, status, status_qualifiers, total_cents, issue_date, vin_snapshot, voided, work_order_id, customer_id"
    )
    .eq("vin_snapshot", vin)
    .order("invoice_number", { ascending: false });
  if (error) return [];
  return (data ?? []).map(toListItem);
}

function toListItem(row: Record<string, unknown>): WixInvoiceListItem {
  return {
    wix_invoice_id: String(row.wix_invoice_id),
    display_number: String(row.display_number),
    status_label: wixStatusLabel(
      String(row.status ?? ""),
      (row.status_qualifiers as string[]) ?? []
    ),
    total_cents: Number(row.total_cents ?? 0),
    issue_date: (row.issue_date as string | null) ?? null,
    vin_snapshot: (row.vin_snapshot as string | null) ?? null,
    voided: Boolean(row.voided),
    work_order_id: (row.work_order_id as string | null) ?? null,
    customer_id: (row.customer_id as string | null) ?? null,
  };
}

export async function blockingAcknowledgementForWorkOrder(workOrderId: string): Promise<{
  acknowledgement_id: string;
  wix_error_text: string;
  hold_revision: number;
} | null> {
  const admin = adminOrNull();
  if (!admin) return null;
  const { data } = await admin
    .from("invoice_create_acknowledgement")
    .select("acknowledgement_id, wix_error_text, hold_revision")
    .eq("work_order_id", workOrderId)
    .is("acknowledged_at", null)
    .is("cleared_at", null)
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  return {
    acknowledgement_id: data.acknowledgement_id as string,
    wix_error_text: data.wix_error_text as string,
    hold_revision: Number(data.hold_revision ?? 1),
  };
}

export async function acknowledgeInvoiceFailure(
  acknowledgementId: string,
  seen: { holdRevision: number; errorText: string }
): Promise<{ applied: boolean }> {
  const user = await requireUser();
  if (!canRecordCustomerApproval(user.role)) throw new Error("FORBIDDEN");
  const admin = createAdminClient();
  const { data: row, error: readError } = await admin
    .from("invoice_create_acknowledgement")
    .select("wix_error_text, hold_revision, acknowledged_at, cleared_at")
    .eq("acknowledgement_id", acknowledgementId)
    .maybeSingle();
  if (readError) throw readError;
  if (!row) return { applied: false };
  const applies = shouldApplyInvoiceAcknowledgement({
    storedRevision: Number(row.hold_revision ?? 1),
    seenRevision: seen.holdRevision,
    storedErrorText: String(row.wix_error_text ?? ""),
    seenErrorText: seen.errorText,
    cleared: Boolean(row.cleared_at),
    alreadyAcknowledged: Boolean(row.acknowledged_at),
  });
  if (!applies) return { applied: false };
  const { data: updated, error } = await admin
    .from("invoice_create_acknowledgement")
    .update({
      acknowledged_at: new Date().toISOString(),
      staff_user_id: user.user_id,
    })
    .eq("acknowledgement_id", acknowledgementId)
    .eq("hold_revision", seen.holdRevision)
    .eq("wix_error_text", seen.errorText)
    .is("acknowledged_at", null)
    .is("cleared_at", null)
    .select("acknowledgement_id");
  if (error) throw error;
  return { applied: (updated ?? []).length > 0 };
}

export type OpenWixIntakeHold = {
  acknowledgementId: string;
  holdRevision: number;
  errorText: string;
  legacyNumberEntry: boolean;
  pendingWorkOrderId: string | null;
};

/** The open intake hold for this customer and bike, if one is still blocking create. */
export async function getOpenWixIntakeHold(
  customerId: string,
  motorcycleId: string
): Promise<OpenWixIntakeHold | null> {
  const user = await requireUser();
  if (!canCreateWorkOrder(user.role)) return null;
  if (!customerId || !motorcycleId) return null;
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("invoice_create_acknowledgement")
    .select(
      "acknowledgement_id, wix_error_text, hold_revision, pending_work_order_id, wix_invoice_id"
    )
    .eq("customer_id", customerId)
    .eq("motorcycle_id", motorcycleId)
    .is("cleared_at", null)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data || data.wix_invoice_id) return null;
  const errorText = String(data.wix_error_text ?? "");
  return {
    acknowledgementId: String(data.acknowledgement_id),
    holdRevision: Number(data.hold_revision ?? 1),
    errorText,
    legacyNumberEntry: isLegacyInvoicesApiUnavailable(errorText),
    pendingWorkOrderId: (data.pending_work_order_id as string | null) ?? null,
  };
}

/**
 * Close the hold after staff save a work order with the invoice number they
 * copied from Wix. Only the legacy-API refusal can be closed this way.
 */
export async function clearLegacyInvoiceHold(acknowledgementId: string): Promise<boolean> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("invoice_create_acknowledgement")
    .select("wix_error_text, wix_invoice_id, cleared_at")
    .eq("acknowledgement_id", acknowledgementId)
    .maybeSingle();
  if (error) throw error;
  if (!data || data.cleared_at || data.wix_invoice_id) return false;
  const errorText = String(data.wix_error_text ?? "");
  if (!isLegacyInvoicesApiUnavailable(errorText)) return false;
  const { data: updated, error: updateError } = await admin
    .from("invoice_create_acknowledgement")
    .update({ cleared_at: new Date().toISOString() })
    .eq("acknowledgement_id", acknowledgementId)
    .eq("wix_error_text", errorText)
    .is("wix_invoice_id", null)
    .is("cleared_at", null)
    .select("acknowledgement_id");
  if (updateError) throw updateError;
  return (updated ?? []).length > 0;
}

async function openHold(
  admin: Admin,
  input: {
    customerId: string;
    motorcycleId: string;
    staffUserId: string;
    workOrderId: string | null;
    pendingWorkOrderId: string;
    message: string;
    wixInvoiceId: string | null;
  }
): Promise<{ acknowledgementId: string; holdRevision: number }> {
  const { data: existing, error: existingError } = await admin
    .from("invoice_create_acknowledgement")
    .select("acknowledgement_id, hold_revision")
    .eq("customer_id", input.customerId)
    .eq("motorcycle_id", input.motorcycleId)
    .is("cleared_at", null)
    .limit(1)
    .maybeSingle();
  if (existingError) throw existingError;
  if (existing?.acknowledgement_id) {
    let expectedRevision = Number(existing.hold_revision ?? 1);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const next = acknowledgementFieldsOnFailedRetry({ holdRevision: expectedRevision });
      const { data: updated, error } = await admin
        .from("invoice_create_acknowledgement")
        .update({
          wix_error_text: input.message,
          wix_invoice_id: input.wixInvoiceId,
          pending_work_order_id: input.pendingWorkOrderId,
          work_order_id: input.workOrderId,
          acknowledged_at: next.acknowledged_at,
          hold_revision: next.hold_revision,
        })
        .eq("acknowledgement_id", existing.acknowledgement_id)
        .eq("hold_revision", expectedRevision)
        .select("acknowledgement_id, hold_revision")
        .maybeSingle();
      if (error) throw error;
      if (updated?.acknowledgement_id) {
        return {
          acknowledgementId: updated.acknowledgement_id as string,
          holdRevision: Number(updated.hold_revision),
        };
      }
      const { data: current, error: rereadError } = await admin
        .from("invoice_create_acknowledgement")
        .select("hold_revision")
        .eq("acknowledgement_id", existing.acknowledgement_id)
        .is("cleared_at", null)
        .maybeSingle();
      if (rereadError) throw rereadError;
      if (current?.hold_revision == null) break;
      expectedRevision = Number(current.hold_revision);
    }
    throw new Error("INVOICE_ACK_REVISION_CONFLICT");
  }
  const { data, error } = await admin
    .from("invoice_create_acknowledgement")
    .insert({
      customer_id: input.customerId,
      motorcycle_id: input.motorcycleId,
      staff_user_id: input.staffUserId,
      work_order_id: input.workOrderId,
      pending_work_order_id: input.pendingWorkOrderId,
      wix_error_text: input.message,
      wix_invoice_id: input.wixInvoiceId,
    })
    .select("acknowledgement_id, hold_revision")
    .single();
  if (error) throw error;
  return {
    acknowledgementId: data.acknowledgement_id as string,
    holdRevision: Number(data.hold_revision ?? 1),
  };
}

export async function prepareIntakeInvoice(input: {
  customerId: string;
  motorcycleId: string;
  mileage: number;
  mileageUnit: "km" | "mi";
  serviceLines: Array<{ serviceId?: string; name: string; price: number; quantity?: number }>;
  technicianName: string | null;
  technicianUserId?: string | null;
  existingWorkOrderId?: string | null;
}): Promise<PreparedIntake> {
  const user = await requireUser();
  if (!canRecordCustomerApproval(user.role)) throw new Error("FORBIDDEN");
  const admin = createAdminClient();

  const { data: customer, error: customerError } = await admin
    .from("customer")
    .select("customer_id, first_name, last_name, phone, email, address, wix_contact_id")
    .eq("customer_id", input.customerId)
    .maybeSingle();
  if (customerError) throw customerError;
  if (!customer) throw new Error("CUSTOMER_NOT_FOUND");

  const { data: bike, error: bikeError } = await admin
    .from("motorcycle")
    .select("motorcycle_id, year, make, model, colour, plate_number, vin")
    .eq("motorcycle_id", input.motorcycleId)
    .maybeSingle();
  if (bikeError) throw bikeError;
  if (!bike) throw new Error("MOTORCYCLE_NOT_FOUND");

  const clientName = `${customer.first_name} ${customer.last_name}`.trim();
  const bikeLabel = `${bike.year} ${bike.make} ${bike.model}`;
  const ready = assertIntakeInvoiceReady({
    clientName,
    phone: customer.phone as string | null,
    email: customer.email as string | null,
    year: Number(bike.year),
    make: String(bike.make),
    model: String(bike.model),
    colour: bike.colour as string | null,
    plate: bike.plate_number as string | null,
    vin: bike.vin as string | null,
  });
  if (!ready.ok) {
    throw new Error(ready.message);
  }

  const { data: hold, error: holdError } = await admin
    .from("invoice_create_acknowledgement")
    .select(
      "acknowledgement_id, acknowledged_at, wix_invoice_id, pending_work_order_id, wix_error_text, hold_revision"
    )
    .eq("customer_id", input.customerId)
    .eq("motorcycle_id", input.motorcycleId)
    .is("cleared_at", null)
    .limit(1)
    .maybeSingle();
  if (holdError) throw holdError;

  if (hold && !hold.acknowledged_at) {
    throw new WixIntakeBlockedError(
      String(hold.wix_error_text),
      String(hold.acknowledgement_id),
      Number(hold.hold_revision ?? 1)
    );
  }

  let workOrderId =
    input.existingWorkOrderId ?? (hold?.pending_work_order_id as string | null) ?? randomUUID();
  let replacesBookingStub = Boolean(input.existingWorkOrderId);
  let externalReferenceId = workOrderId;
  if (!input.existingWorkOrderId) {
    const { data: stub } = await admin
      .from("work_order")
      .select("work_order_id")
      .eq("motorcycle_id", input.motorcycleId)
      .eq("source", "wix_booking")
      .not("status", "in", "(completed,cancelled)")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (stub?.work_order_id) {
      workOrderId = stub.work_order_id as string;
      externalReferenceId = workOrderId;
      replacesBookingStub = true;
    }
  } else {
    const { data: already } = await admin
      .from("wix_invoice")
      .select("wix_invoice_id")
      .eq("work_order_id", input.existingWorkOrderId)
      .limit(1)
      .maybeSingle();
    if (already?.wix_invoice_id) {
      externalReferenceId = randomUUID();
      replacesBookingStub = false;
    }
  }

  let record: WixInvoiceRecord | null = null;
  const reusedId = (hold?.wix_invoice_id as string | null) ?? null;
  if (reusedId) {
    try {
      record = await getWixInvoice(reusedId);
    } catch {
      record = null;
    }
  }
  if (!record) {
    const { data: pending } = await admin
      .from("wix_invoice")
      .select("wix_invoice_id")
      .eq("pending_work_order_id", workOrderId)
      .limit(1)
      .maybeSingle();
    if (pending?.wix_invoice_id) {
      record = await getWixInvoice(String(pending.wix_invoice_id));
    }
  }

  const namedLines = await resolveServiceNames(admin, input.serviceLines);
  const technician =
    input.technicianName ??
    (await technicianName(admin, input.technicianUserId ?? null));

  let draftCreditCents = 0;
  if (!record) {
    try {
      if (!customer.wix_contact_id) {
        const synced = await syncCustomerToWix(input.customerId);
        customer.wix_contact_id = synced.wix_contact_id;
      }
      if (!customer.wix_contact_id) throw new Error("WIX_CONTACT_SYNC_FAILED");
      const currency = getWixContactsConfig().currency || "CAD";
      draftCreditCents = await creditCentsForOpenInvoice(admin, input.customerId, null);
      const body = buildDraftInvoiceBody({
        contactId: String(customer.wix_contact_id),
        externalReferenceId,
        issueDate: new Date().toISOString(),
        currency,
        title: invoiceTitle(Number(bike.year), String(bike.make), String(bike.model)),
        firstName: String(customer.first_name),
        lastName: String(customer.last_name),
        email: customer.email as string | null,
        phone: customer.phone as string | null,
        address: customer.address as string | null,
        lines: namedLines,
        creditCents: draftCreditCents,
        header: bikeHeaderFields({
          vin: String(bike.vin),
          plate: String(bike.plate_number),
          colour: String(bike.colour ?? "").trim(),
          mileage: `${input.mileage} ${input.mileageUnit}`,
        }),
        technicianName: technician,
      });
      record = await createWixInvoice(body.invoice as Record<string, unknown>);
    } catch (error) {
      if (error instanceof WixIntakeBlockedError) throw error;
      const reason = error instanceof Error ? error.message : "Wix invoice create failed.";
      if (error instanceof WixInvoiceApiError) {
        console.error("Wix invoice create failed", {
          status: error.status,
          legacyApiUnavailable: isLegacyInvoicesApiUnavailable(reason),
        });
      }
      const message = intakeFailureMessage({ clientName, bikeLabel, wixReason: reason });
      const opened = await openHold(admin, {
        customerId: input.customerId,
        motorcycleId: input.motorcycleId,
        staffUserId: user.user_id,
        workOrderId: replacesBookingStub ? workOrderId : null,
        pendingWorkOrderId: workOrderId,
        message,
        wixInvoiceId: null,
      });
      throw new WixIntakeBlockedError(message, opened.acknowledgementId, opened.holdRevision);
    }
  }

  if (record?.id && !draftHasDisplayNumber(record)) {
    const invoiceId = record.id;
    try {
      if (
        draftNeedsNumberAllocation({
          status: record.status,
          displayNumber: record.numbering?.displayNumber,
        })
      ) {
        record = await publishWixInvoice(invoiceId);
      }
      if (!draftHasDisplayNumber(record)) {
        record = await getWixInvoice(invoiceId);
      }
    } catch (error) {
      if (error instanceof WixIntakeBlockedError) throw error;
      const reason = error instanceof Error ? error.message : "Wix invoice publish failed.";
      const message = intakeFailureMessage({ clientName, bikeLabel, wixReason: reason });
      const opened = await openHold(admin, {
        customerId: input.customerId,
        motorcycleId: input.motorcycleId,
        staffUserId: user.user_id,
        workOrderId: replacesBookingStub ? workOrderId : null,
        pendingWorkOrderId: workOrderId,
        message,
        wixInvoiceId: invoiceId,
      });
      throw new WixIntakeBlockedError(message, opened.acknowledgementId, opened.holdRevision);
    }
  }

  if (!draftHasDisplayNumber(record)) {
    const message = intakeFailureMessage({
      clientName,
      bikeLabel,
      wixReason: "Wix created the invoice without a display number.",
    });
    const opened = await openHold(admin, {
      customerId: input.customerId,
      motorcycleId: input.motorcycleId,
      staffUserId: user.user_id,
      workOrderId: replacesBookingStub ? workOrderId : null,
      pendingWorkOrderId: workOrderId,
      message,
      wixInvoiceId: record.id ?? null,
    });
    throw new WixIntakeBlockedError(message, opened.acknowledgementId, opened.holdRevision);
  }

  await upsertInvoiceFromRecord(record, { excludeFromSquare: false });
  await admin
    .from("wix_invoice")
    .update({
      pending_work_order_id: replacesBookingStub || input.existingWorkOrderId ? null : workOrderId,
      work_order_id: replacesBookingStub || input.existingWorkOrderId ? workOrderId : null,
      customer_id: input.customerId,
      motorcycle_id: input.motorcycleId,
      vin_snapshot: String(bike.vin),
    })
    .eq("wix_invoice_id", record.id);
  if (draftCreditCents > 0 && record.id) {
    await reserveCustomerCredit(admin, input.customerId, record.id, draftCreditCents);
  }

  if (hold && acknowledgementClearedOnSuccess({ retrySucceeded: true })) {
    await admin
      .from("invoice_create_acknowledgement")
      .update({ cleared_at: new Date().toISOString() })
      .eq("acknowledgement_id", hold.acknowledgement_id);
  }

  return {
    displayNumber: record.numbering!.displayNumber!,
    wixInvoiceId: record.id!,
    workOrderId,
    replacesBookingStub,
  };
}

export async function attachInvoiceToWorkOrder(
  wixInvoiceId: string,
  workOrderId: string
): Promise<void> {
  const admin = createAdminClient();
  await admin
    .from("wix_invoice")
    .update({
      work_order_id: workOrderId,
      pending_work_order_id: null,
      updated_at: new Date().toISOString(),
    })
    .eq("wix_invoice_id", wixInvoiceId);
}

export async function pushWorkOrderLinesToWix(workOrderId: string): Promise<void> {
  if (!wixInvoicesEnabled()) return;
  const admin = adminOrNull();
  if (!admin) return;
  const { data: invoices } = await admin
    .from("wix_invoice")
    .select("wix_invoice_id, revision, status, voided, display_number")
    .eq("work_order_id", workOrderId)
    .order("invoice_number", { ascending: false });
  const open = (invoices ?? []).find(
    (row) => !row.voided && canSyncInvoiceLines(String(row.status))
  );
  const { data: workOrder } = await admin
    .from("work_order")
    .select(
      "work_order_id, customer_id, motorcycle_id, mileage, mileage_unit, primary_technician_id, work_order_number"
    )
    .eq("work_order_id", workOrderId)
    .maybeSingle();
  if (!workOrder) return;

  const lines = await loadWorkOrderLines(admin, workOrderId);
  if (!open) {
    const sealed = (invoices ?? []).some((row) => invoiceIsSealed(String(row.status)) || row.voided);
    if (!sealed) return;
    const tech = await technicianName(admin, workOrder.primary_technician_id as string | null);
    await prepareIntakeInvoice({
      customerId: String(workOrder.customer_id),
      motorcycleId: String(workOrder.motorcycle_id),
      mileage: Number(workOrder.mileage ?? 0),
      mileageUnit: workOrder.mileage_unit === "mi" ? "mi" : "km",
      serviceLines: lines,
      technicianName: tech,
      existingWorkOrderId: workOrderId,
    });
    return;
  }

  const remote = await getWixInvoice(String(open.wix_invoice_id));
  if (!canSyncInvoiceLines(remote.status)) return;
  const { data: bike } = await admin
    .from("motorcycle")
    .select("year, make, model, colour, plate_number, vin")
    .eq("motorcycle_id", workOrder.motorcycle_id)
    .maybeSingle();
  if (!bike) return;
  const tech = await technicianName(admin, workOrder.primary_technician_id as string | null);
  const credit = await creditCentsForOpenInvoice(
    admin,
    String(workOrder.customer_id),
    String(open.wix_invoice_id)
  );
  const updated = await updateWixInvoice(
    String(open.wix_invoice_id),
    buildLineUpdate({
      revision: String(remote.revision ?? open.revision),
      lines,
      title: invoiceTitle(Number(bike.year), String(bike.make), String(bike.model)),
      header: bikeHeaderFields({
        vin: String(bike.vin ?? ""),
        plate: String(bike.plate_number ?? "N/A"),
        colour: String(bike.colour ?? ""),
        mileage: `${workOrder.mileage ?? 0} ${workOrder.mileage_unit ?? "km"}`,
      }),
      technicianName: tech,
      creditCents: credit,
    }).invoice as Record<string, unknown>
  );
  await upsertInvoiceFromRecord(updated);
  if (credit > 0) {
    await reserveCustomerCredit(
      admin,
      String(workOrder.customer_id),
      String(open.wix_invoice_id),
      credit
    );
  }
}

async function resolveServiceNames(
  admin: Admin,
  lines: Array<{ serviceId?: string; name: string; price: number; quantity?: number }>
): Promise<Array<{ name: string; price: number; quantity?: number }>> {
  const ids = lines.map((line) => line.serviceId).filter((id): id is string => Boolean(id));
  const names = new Map<string, string>();
  if (ids.length > 0) {
    const { data } = await admin.from("service").select("service_id, name").in("service_id", ids);
    for (const row of data ?? []) names.set(String(row.service_id), String(row.name));
  }
  return lines.map((line) => ({
    name: (line.serviceId && names.get(line.serviceId)) || line.name,
    price: line.price,
    quantity: line.quantity,
  }));
}

async function loadWorkOrderLines(
  admin: Admin,
  workOrderId: string
): Promise<Array<{ name: string; price: number; quantity?: number }>> {
  const { data: jobs } = await admin
    .from("job")
    .select("service_name_snapshot, standard_price_snapshot, status")
    .eq("work_order_id", workOrderId);
  const lines: Array<{ name: string; price: number; quantity?: number }> = (jobs ?? [])
    .filter((job) => job.status !== "declined" && job.status !== "cancelled")
    .map((job) => ({
      name: String(job.service_name_snapshot ?? "Service"),
      price: Number(job.standard_price_snapshot ?? 0),
    }));
  const { data: jobIds } = await admin.from("job").select("job_id").eq("work_order_id", workOrderId);
  const ids = (jobIds ?? []).map((job) => job.job_id as string);
  if (ids.length === 0) return lines;
  const { data: parts } = await admin
    .from("part")
    .select("part_name, quantity, unit_price")
    .in("job_id", ids);
  for (const part of parts ?? []) {
    lines.push({
      name: String(part.part_name ?? "Part"),
      price: Number(part.unit_price ?? 0),
      quantity: Number(part.quantity ?? 1),
    });
  }
  return lines;
}

async function technicianName(admin: Admin, userId: string | null): Promise<string | null> {
  if (!userId) return null;
  const { data } = await admin
    .from("app_user")
    .select("first_name, last_name")
    .eq("user_id", userId)
    .maybeSingle();
  if (!data) return null;
  return `${data.first_name} ${data.last_name}`.trim();
}

export async function syncCustomerDrafts(customerId: string): Promise<void> {
  if (!wixInvoicesEnabled()) return;
  const admin = adminOrNull();
  if (!admin) return;
  const { data: customer } = await admin
    .from("customer")
    .select("first_name, last_name, phone, email, address, wix_contact_id")
    .eq("customer_id", customerId)
    .maybeSingle();
  if (!customer?.wix_contact_id) return;
  const { data: drafts } = await admin
    .from("wix_invoice")
    .select("wix_invoice_id, revision, status")
    .eq("customer_id", customerId)
    .in("status", ["DRAFT", "PUBLISHED"])
    .eq("voided", false);
  for (const draft of drafts ?? []) {
    if (!canSyncCustomerBlock(String(draft.status))) continue;
    const remote = await getWixInvoice(String(draft.wix_invoice_id));
    if (!canSyncCustomerBlock(remote.status)) continue;
    const updated = await updateWixInvoice(String(draft.wix_invoice_id), {
      revision: String(remote.revision ?? draft.revision),
      customerInfo: {
        contactId: customer.wix_contact_id,
        contactDetails: {
          firstName: customer.first_name,
          lastName: customer.last_name,
          email: customer.email || undefined,
          phone: customer.phone || undefined,
        },
        ...(customer.address
          ? {
              billingAddress: {
                country: "CA",
                addressLine: String(customer.address).slice(0, 150),
              },
            }
          : {}),
      },
    });
    await upsertInvoiceFromRecord(updated);
  }
}

export async function publishWorkOrderInvoice(input: {
  workOrderId: string;
  dueDate?: string | null;
}): Promise<void> {
  const user = await requireUser();
  if (!canRecordCustomerApproval(user.role)) throw new Error("FORBIDDEN");
  const admin = createAdminClient();
  const { data: invoice } = await admin
    .from("wix_invoice")
    .select("wix_invoice_id, revision, status, due_date")
    .eq("work_order_id", input.workOrderId)
    .eq("voided", false)
    .order("invoice_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!invoice) throw new Error("WIX_INVOICE_NOT_FOUND");
  const storedStatus = String(invoice.status ?? "").toUpperCase();
  if (storedStatus !== "DRAFT" && storedStatus !== "PUBLISHED") {
    throw new Error("WIX_INVOICE_NOT_DRAFT");
  }
  const due = shopDueDateIso(
    input.dueDate || (invoice.due_date as string | null),
    shopTodayIso()
  );
  const invoiceId = String(invoice.wix_invoice_id);
  const remote = await getWixInvoice(invoiceId);
  const remoteStatus = String(remote.status ?? storedStatus).toUpperCase();
  if (remoteStatus !== "DRAFT" && remoteStatus !== "PUBLISHED") {
    throw new Error("WIX_INVOICE_NOT_DRAFT");
  }
  await updateWixInvoice(invoiceId, {
    revision: String(remote.revision ?? invoice.revision),
    dueDate: due,
  });
  let published =
    remoteStatus === "DRAFT" ? await publishWixInvoice(invoiceId) : await getWixInvoice(invoiceId);
  const sent = (published.statusQualifiers ?? []).some((flag) => flag.toUpperCase() === "SENT");
  if (!sent) {
    published = await sendWixInvoice(invoiceId);
  }
  let payUrl = payUrlFromInvoice(published);
  if (!payUrl) {
    try {
      payUrl = await initiateWixInvoicePayment(String(invoice.wix_invoice_id));
    } catch {
      payUrl = null;
    }
  }
  if (payUrl) published = { ...published, dynamicInvoiceUrl: payUrl };
  await upsertInvoiceFromRecord(published);
}

export type SquareAskItem = {
  wix_invoice_payment_id: string;
  wix_payment_id: string;
  display_number: string;
  client_name: string;
  amount_cents: number;
  method: string;
  kind: string;
  square_status: string;
  work_order_id: string | null;
};

export async function listSquareAsks(): Promise<SquareAskItem[]> {
  const user = await requireUser();
  if (!canViewPricing(user.role)) return [];
  const admin = adminOrNull();
  if (!admin) return [];
  const { data, error } = await admin
    .from("wix_invoice_payment")
    .select(
      "wix_invoice_payment_id, wix_payment_id, amount_cents, method, kind, square_status, wix_invoice:wix_invoice_id ( display_number, voided, exclude_from_square, work_order_id, customer:customer_id ( first_name, last_name ) )"
    )
    .in("square_status", ["unasked", "not_yet"]);
  if (error || !data) return [];
  return (data as Array<Record<string, unknown>>)
    .filter((row) => {
      const invoice = row.wix_invoice as {
        voided?: boolean;
        exclude_from_square?: boolean;
      } | null;
      return invoice && !invoice.voided && !invoice.exclude_from_square;
    })
    .map((row) => {
      const invoice = row.wix_invoice as {
        display_number?: string;
        work_order_id?: string | null;
        customer?: { first_name?: string; last_name?: string } | null;
      };
      const customer = invoice.customer;
      return {
        wix_invoice_payment_id: String(row.wix_invoice_payment_id),
        wix_payment_id: String(row.wix_payment_id),
        display_number: String(invoice.display_number ?? ""),
        client_name: `${customer?.first_name ?? ""} ${customer?.last_name ?? ""}`.trim() || "Client",
        amount_cents: Number(row.amount_cents ?? 0),
        method: String(row.method ?? ""),
        kind: String(row.kind ?? "payment"),
        square_status: String(row.square_status),
        work_order_id: invoice.work_order_id ?? null,
      };
    });
}

async function squarePaymentRow(
  admin: Admin,
  wixPaymentId: string,
  clientName: string,
  displayNumber: string
): Promise<string> {
  const { data: row } = await admin
    .from("wix_invoice_payment")
    .select("wix_invoice_payment_id, amount_cents, square_status, square_payment_id, kind, method, wix_invoice_id")
    .eq("wix_payment_id", wixPaymentId)
    .maybeSingle();
  if (!row) throw new Error("WIX_PAYMENT_NOT_FOUND");
  if (row.square_status === "squared" && row.square_payment_id) {
    return String(row.square_payment_id);
  }
  if (row.kind === "refund") {
    if (row.method === "square" || !row.square_payment_id) {
      throw new Error("WIX_REFUND_RECORD_UNSUPPORTED");
    }
    const refund = await refundSquarePayment({
      paymentId: String(row.square_payment_id),
      idempotencyKey: squareIdempotencyKey(wixPaymentId),
      amountCents: Number(row.amount_cents),
      currency: "CAD",
      reason: squareRecordName(clientName, displayNumber),
    });
    await admin
      .from("wix_invoice_payment")
      .update({
        square_status: "squared",
        square_payment_id: refund.id,
        updated_at: new Date().toISOString(),
      })
      .eq("wix_payment_id", wixPaymentId);
    return refund.id;
  }
  const created = await createSquareExternalPayment({
    idempotencyKey: squareIdempotencyKey(wixPaymentId),
    amountCents: Number(row.amount_cents),
    currency: "CAD",
    recordName: squareRecordName(clientName, displayNumber),
  });
  await admin
    .from("wix_invoice_payment")
    .update({
      square_status: "squared",
      square_payment_id: created.id,
      updated_at: new Date().toISOString(),
    })
    .eq("wix_payment_id", wixPaymentId);
  return created.id;
}

export async function answerSquareAsk(input: {
  wixPaymentId: string;
  answer: "yes" | "not_yet";
}): Promise<void> {
  const user = await requireUser();
  if (!canRecordCustomerApproval(user.role)) throw new Error("FORBIDDEN");
  const admin = createAdminClient();
  const { data: row } = await admin
    .from("wix_invoice_payment")
    .select("square_status, wix_invoice:wix_invoice_id ( display_number, voided, exclude_from_square, customer:customer_id ( first_name, last_name ) )")
    .eq("wix_payment_id", input.wixPaymentId)
    .maybeSingle();
  if (!row) throw new Error("WIX_PAYMENT_NOT_FOUND");
  const invoice = row.wix_invoice as {
    display_number?: string;
    voided?: boolean;
    exclude_from_square?: boolean;
    customer?: { first_name?: string; last_name?: string } | null;
  } | null;
  if (!invoice || invoice.voided || invoice.exclude_from_square) {
    throw new Error("WIX_PAYMENT_EXCLUDED");
  }
  if (row.square_status === "squared") return;
  if (input.answer === "not_yet") {
    await admin
      .from("wix_invoice_payment")
      .update({ square_status: "not_yet", updated_at: new Date().toISOString() })
      .eq("wix_payment_id", input.wixPaymentId);
    return;
  }
  const clientName = `${invoice.customer?.first_name ?? ""} ${invoice.customer?.last_name ?? ""}`.trim();
  await squarePaymentRow(admin, input.wixPaymentId, clientName || "Client", String(invoice.display_number));
}

export async function voidAndSquareVisit(input: {
  workOrderId: string;
  squarePaymentId?: string | null;
  offlineAmountCents?: number | null;
}): Promise<void> {
  const user = await requireUser();
  if (!canRecordCustomerApproval(user.role)) throw new Error("FORBIDDEN");
  const admin = createAdminClient();
  const { data: invoice } = await admin
    .from("wix_invoice")
    .select("wix_invoice_id, display_number, voided, customer:customer_id ( first_name, last_name )")
    .eq("work_order_id", input.workOrderId)
    .order("invoice_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!invoice) throw new Error("WIX_INVOICE_NOT_FOUND");
  let terminalAmount: number | null = null;
  if (input.squarePaymentId?.trim()) {
    const payments = await listRecentSquarePayments(50);
    const match = payments.find((payment) => payment.id === input.squarePaymentId?.trim());
    if (!match) throw new Error("SQUARE_TERMINAL_PAYMENT_NOT_FOUND");
    terminalAmount = match.amountCents;
  }
  const recorded = recordedCentsForVisit({
    terminalAmountCents: terminalAmount,
    offlineAmountCents: input.offlineAmountCents ?? null,
  });
  if (!invoice.voided) {
    const remote = await voidWixInvoice(String(invoice.wix_invoice_id));
    await upsertInvoiceFromRecord(remote);
  }
  await admin
    .from("wix_invoice_payment")
    .update({ square_status: "skipped_void", updated_at: new Date().toISOString() })
    .eq("wix_invoice_id", invoice.wix_invoice_id)
    .neq("square_status", "squared");

  const customer = invoice.customer as { first_name?: string; last_name?: string } | null;
  const clientName = `${customer?.first_name ?? ""} ${customer?.last_name ?? ""}`.trim() || "Client";
  const displayNumber = String(invoice.display_number);
  if (input.squarePaymentId?.trim()) {
    const key = squareIdempotencyKey(input.squarePaymentId.trim());
    await admin.from("wix_invoice_payment").upsert(
      {
        wix_payment_id: `terminal:${invoice.wix_invoice_id}:${key}`,
        wix_invoice_id: invoice.wix_invoice_id,
        amount_cents: recorded,
        method: "terminal",
        kind: "payment",
        square_status: "squared",
        square_payment_id: input.squarePaymentId.trim(),
      },
      { onConflict: "wix_payment_id" }
    );
  } else {
    const created = await createSquareExternalPayment({
      idempotencyKey: squareIdempotencyKey(`void:${invoice.wix_invoice_id}`),
      amountCents: recorded,
      currency: "CAD",
      recordName: squareRecordName(clientName, displayNumber),
    });
    await admin.from("wix_invoice_payment").upsert(
      {
        wix_payment_id: `offline:${invoice.wix_invoice_id}`,
        wix_invoice_id: invoice.wix_invoice_id,
        amount_cents: recorded,
        method: "offline",
        kind: "payment",
        square_status: "squared",
        square_payment_id: created.id,
      },
      { onConflict: "wix_payment_id" }
    );
  }
}

export async function recentTerminalPayments(): Promise<SquarePaymentListItem[]> {
  const user = await requireUser();
  if (!canRecordCustomerApproval(user.role)) throw new Error("FORBIDDEN");
  return listRecentSquarePayments(20);
}

export async function portalInvoiceForWorkOrder(workOrderId: string): Promise<{
  displayNumber: string;
  statusLabel: string;
  payUrl: string | null;
  totalCents: number;
  sent: boolean;
} | null> {
  if (!wixInvoicesEnabled()) return null;
  const admin = adminOrNull();
  if (!admin) return null;
  const { data } = await admin
    .from("wix_invoice")
    .select("display_number, status, status_qualifiers, pay_url, total_cents, voided")
    .eq("work_order_id", workOrderId)
    .eq("voided", false)
    .order("invoice_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  const qualifiers = (data.status_qualifiers as string[]) ?? [];
  return {
    displayNumber: String(data.display_number),
    statusLabel: wixStatusLabel(String(data.status), qualifiers),
    payUrl: (data.pay_url as string | null) ?? null,
    totalCents: Number(data.total_cents ?? 0),
    sent: qualifiers.some((flag) => flag.toUpperCase() === "SENT"),
  };
}

export async function handleInvoiceWebhook(body: {
  event?: string;
  invoice?: WixInvoiceRecord;
  invoiceId?: string;
  revision?: string;
}): Promise<{ ignored: boolean }> {
  if (!wixInvoicesEnabled()) return { ignored: true };
  const invoiceId = (body.invoice?.id ?? body.invoiceId ?? "").trim();
  if (!isWixInvoiceId(invoiceId)) throw new Error("WIX_WEBHOOK_INVOICE_REQUIRED");
  const event = (body.event ?? "").toLowerCase();
  if (event.includes("deleted") || event.includes("delete")) {
    return deleteInvoiceIfWixGone(invoiceId);
  }
  return upsertInvoiceFromRecord(await getWixInvoice(invoiceId));
}

async function deleteInvoiceIfWixGone(invoiceId: string): Promise<{ ignored: boolean }> {
  try {
    await getWixInvoice(invoiceId);
    return { ignored: true };
  } catch (error) {
    if (error instanceof WixInvoiceApiError && error.status === 404) {
      await deleteInvoiceLocally(invoiceId);
      return { ignored: false };
    }
    throw error;
  }
}

export async function noteSquareRefundAsk(input: {
  eventId: string;
  amountCents: number;
  workOrderId?: string | null;
}): Promise<void> {
  if (!wixInvoicesEnabled()) return;
  const admin = adminOrNull();
  if (!admin || !input.workOrderId) return;
  const { data: invoice } = await admin
    .from("wix_invoice")
    .select("wix_invoice_id, voided, exclude_from_square")
    .eq("work_order_id", input.workOrderId)
    .order("invoice_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!invoice || invoice.voided || invoice.exclude_from_square) return;
  const paymentId = `square-refund:${input.eventId}`;
  const { data: existing } = await admin
    .from("wix_invoice_payment")
    .select("wix_payment_id")
    .eq("wix_payment_id", paymentId)
    .maybeSingle();
  if (existing) return;
  await admin.from("wix_invoice_payment").insert({
    wix_payment_id: paymentId,
    wix_invoice_id: invoice.wix_invoice_id,
    amount_cents: input.amountCents,
    method: "square",
    kind: "refund",
    square_status: "unasked",
  });
}

export function invoiceWebhookShouldIgnore(
  storedRevision: string | null,
  incomingRevision: string | null
): boolean {
  return shouldIgnoreIncomingRevision(storedRevision, incomingRevision);
}

export { WixInvoiceApiError };
