/**
 * Pure decision logic for Square webhook processing so dedupe and money
 * math are unit-testable without a database.
 *
 * Event lifecycle (integration_event): a row that reached "processed" is a
 * replay and must be skipped; "failed"/"processing"/"received" rows are
 * retries and must be processed again. Legacy square_webhook_event rows are
 * inserted only AFTER successful processing, so their presence also means
 * "already processed".
 */

export type IntegrationEventStatus =
  "received" | "processing" | "processed" | "failed" | "ignored";

/** True when a previously stored event row means we must not process again. */
export function shouldSkipIntegrationEvent(
  existingStatus: IntegrationEventStatus | string | null | undefined
): boolean {
  return existingStatus === "processed" || existingStatus === "ignored";
}

export type LegacyPaymentEventInput = {
  /** Mapped Square status: paid | partially_paid | unpaid | cancelled | refunded. */
  mapped: string;
  /** work_order.square_payment_status before this event. */
  previousStatus: string | null;
  previousCollectedCents: number;
  /** Square's total completed money for the invoice (authoritative when present). */
  paidAmountCents: number | null;
  /** Amount the current invoice was published for. */
  billingAmountCents: number | null;
  /** Current invoice is a deposit (deposit_percent/custom mode). */
  isDeposit: boolean;
};

export type LegacyPaymentEventResult = {
  /** Column updates to apply to work_order (never includes keys that must not change). */
  updates: Record<string, unknown>;
  /** True when the event is a duplicate and must not change collections. */
  duplicate: boolean;
};

/**
 * Compute the legacy work_order billing updates for a Square payment event.
 *
 * - A repeated "paid" event for an invoice that is already paid never adds
 *   to collections (fixes cumulative double-collection on webhook replays).
 * - Refunds mark the status but NEVER increase collections.
 */
export function buildLegacyPaymentStatusUpdates(
  input: LegacyPaymentEventInput
): LegacyPaymentEventResult {
  const updates: Record<string, unknown> = {
    square_payment_status: input.mapped,
  };

  if (input.mapped === "paid") {
    if (input.previousStatus === "paid") {
      return { updates: {}, duplicate: true };
    }
    const add = input.paidAmountCents ?? input.billingAmountCents ?? 0;
    updates.billing_collected_cents = input.previousCollectedCents + (add > 0 ? add : 0);
    updates.billing_stage = input.isDeposit ? "ready_to_invoice" : "paid";
    return { updates, duplicate: false };
  }

  if (input.mapped === "partially_paid") {
    updates.billing_stage = "invoiced";
    if (input.paidAmountCents != null) {
      updates.billing_collected_cents = Math.max(
        input.previousCollectedCents,
        input.paidAmountCents
      );
    }
    return { updates, duplicate: false };
  }

  if (input.mapped === "cancelled") {
    updates.billing_stage = "none";
    return { updates, duplicate: false };
  }

  // refunded / unpaid: status only — collections must never grow here.
  return { updates, duplicate: false };
}

/** Payment status accepted by workflow_v2_apply_payment_event for a mapped event. */
export function v2PaymentStatusForMapped(mapped: string): string | null {
  if (mapped === "paid") return "succeeded";
  if (mapped === "refunded") return "refunded";
  // Partial payments are ledgered only when real payment ids are available;
  // invoice-level events cannot be made idempotent per partial payment.
  return null;
}

/**
 * Deterministic provider transaction id for invoice-level Square events.
 * There is exactly one terminal "paid" (and one "refunded") per invoice, so
 * this id keeps workflow_v2_apply_payment_event idempotent across replays.
 */
export function squareInvoiceTransactionId(invoiceId: string, mapped: string): string {
  return `sq-invoice:${invoiceId}:${mapped}`;
}
