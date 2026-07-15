import type { BillingStage } from "@/lib/billing/stages";

export type BillingBucket =
  | "awaiting_approval"
  | "ready_to_invoice"
  | "unpaid"
  | "balance_due"
  | "paid"
  | "other";

export function classifyBillingBucket(input: {
  billing_stage: BillingStage | string;
  square_payment_status: string | null;
  billing_collected_cents: number;
  estimate_cents: number;
}): BillingBucket {
  const stage = input.billing_stage || "none";
  const remaining = Math.max(0, input.estimate_cents - input.billing_collected_cents);

  if (stage === "paid" && remaining <= 0) return "paid";
  if (stage === "awaiting_approval") return "awaiting_approval";
  if (stage === "ready_to_invoice") {
    if (input.billing_collected_cents > 0 && remaining > 0) return "balance_due";
    return "ready_to_invoice";
  }
  if (stage === "invoiced") {
    if (input.square_payment_status === "partially_paid") return "balance_due";
    if (input.billing_collected_cents > 0 && remaining > 0) return "balance_due";
    return "unpaid";
  }
  if (
    input.billing_collected_cents > 0 &&
    remaining > 0 &&
    (stage === "paid" || input.square_payment_status === "paid")
  ) {
    return "balance_due";
  }
  return "other";
}

export const BILLING_BUCKET_LABELS: Record<BillingBucket, string> = {
  awaiting_approval: "Awaiting approval",
  ready_to_invoice: "Ready to invoice",
  unpaid: "Unpaid",
  balance_due: "Balance due",
  paid: "Paid",
  other: "Other",
};
