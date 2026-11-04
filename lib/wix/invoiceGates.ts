/**
 * Fail-closed decision for turning Wix invoices on.
 * A passing report still requires a human to set the env switches.
 */

import { LEGAL_ENTITY_NAME, ONTARIO_HST_RATE } from "@/lib/wix/invoiceRules";

export type InvoiceGateReport = {
  latestNumberStatus: number | null;
  latestNumber: number | null;
  /** Null when the draft probe was not run. */
  probeDraftStatus: number | null;
  probeDisplayNumber: string | null;
  businessName: string | null;
  /** True when site properties show Ontario and the app will not add HST. */
  ontarioHst: boolean;
  squareLocationOk: boolean;
  /** True when the Square client records EXTERNAL payments and does not charge a card. */
  squareExternalPaymentReady: boolean;
};

export type InvoiceGateDecision = {
  ok: boolean;
  reasons: string[];
};

export function evaluateInvoiceGates(report: InvoiceGateReport): InvoiceGateDecision {
  const reasons: string[] = [];

  if (report.latestNumberStatus === 428 || report.probeDraftStatus === 428) {
    reasons.push(
      "Wix returned 428. This site is not on Get Paid Invoices yet, so intake must stay on the current path."
    );
  }

  if (report.latestNumberStatus !== 200 || report.latestNumber == null) {
    reasons.push("GET /invoices/v4/invoices/get-latest-number did not return a number.");
  }

  if (report.probeDraftStatus == null) {
    reasons.push(
      "Draft numbering has not been probed. Run with --probe-draft before the flag can turn on. The app never invents the next number."
    );
  } else if (report.probeDraftStatus !== 200 && report.probeDraftStatus !== 201) {
    reasons.push(`Creating a draft returned HTTP ${report.probeDraftStatus}.`);
  }

  if (report.probeDraftStatus != null && !report.probeDisplayNumber?.trim()) {
    reasons.push(
      "The draft did not return numbering.displayNumber. Leave WIX_INVOICES_ENABLED off."
    );
  }

  if ((report.businessName ?? "").trim() !== LEGAL_ENTITY_NAME) {
    reasons.push(
      `Site business name must be ${LEGAL_ENTITY_NAME}. The app does not write Wix invoice settings.`
    );
  }

  if (!report.ontarioHst) {
    reasons.push(
      `Site properties must show Ontario so Wix adds HST at ${ONTARIO_HST_RATE}. The app sends pre-tax lines only.`
    );
  }

  if (!report.squareLocationOk || !report.squareExternalPaymentReady) {
    reasons.push(
      "Square must be able to record a completed external payment (source_id EXTERNAL) without charging a card, and list recent payments for staff to pick."
    );
  }

  return { ok: reasons.length === 0, reasons };
}

export function ontarioAddressIndicatesHst(input: {
  country: string | null | undefined;
  subdivision: string | null | undefined;
  currency: string | null | undefined;
  taxRate: string | null | undefined;
}): boolean {
  const country = (input.country ?? "").trim().toUpperCase();
  const subdivision = (input.subdivision ?? "").trim().toUpperCase();
  const currency = (input.currency ?? "").trim().toUpperCase();
  const rate = (input.taxRate ?? "").trim();
  const ontario =
    (country === "CA" || country === "CAN" || country === "CANADA") &&
    (subdivision === "ON" || subdivision === "ONTARIO" || subdivision.endsWith("-ON"));
  if (rate === ONTARIO_HST_RATE || rate === "13" || rate === "13%") {
    return ontario || currency === "CAD";
  }
  return ontario && (currency === "CAD" || currency === "");
}
