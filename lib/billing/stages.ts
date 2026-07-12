export const BILLING_STAGES = [
  "none",
  "draft",
  "awaiting_approval",
  "ready_to_invoice",
  "invoiced",
  "paid",
] as const;

export type BillingStage = (typeof BILLING_STAGES)[number];

export const BILLING_AMOUNT_MODES = [
  "full",
  "deposit_percent",
  "custom",
  "balance",
] as const;

export type BillingAmountMode = (typeof BILLING_AMOUNT_MODES)[number];

export const PUBLISHABLE_JOB_STATUSES = [
  "approved",
  "waiting_for_parts",
  "ready_to_start",
  "in_progress",
  "completed",
] as const;

export const DRAFT_JOB_STATUSES = [
  "waiting_for_approval",
  ...PUBLISHABLE_JOB_STATUSES,
] as const;

export type BillableLine = { name: string; amount: number };

export function sumLines(lines: BillableLine[]): number {
  return lines.reduce((sum, line) => sum + line.amount, 0);
}

/** Compute cents to charge for a publish, capped at remaining. */
export function computePublishAmountCents(input: {
  mode: BillingAmountMode;
  billableTotalCents: number;
  collectedCents: number;
  depositPercent?: number;
  customCents?: number;
}): number {
  const remaining = Math.max(0, input.billableTotalCents - input.collectedCents);
  if (remaining <= 0) return 0;

  switch (input.mode) {
    case "full":
    case "balance":
      return remaining;
    case "deposit_percent": {
      const pct = input.depositPercent ?? 0;
      if (pct <= 0 || pct > 100) return 0;
      return Math.min(remaining, Math.round((remaining * pct) / 100));
    }
    case "custom": {
      const custom = input.customCents ?? 0;
      if (custom <= 0) return 0;
      return Math.min(remaining, custom);
    }
    default:
      return 0;
  }
}

/**
 * Recompute billing_stage after job approve/decline when not yet invoiced/paid.
 * Preserves awaiting_approval if estimate was sent and jobs still await approval.
 */
export function stageAfterJobApprovals(input: {
  current: BillingStage;
  hasPublishableLines: boolean;
  hasAwaitingApproval: boolean;
  hasSquareDraft: boolean;
  estimateSent: boolean;
}): BillingStage {
  if (input.current === "invoiced" || input.current === "paid") {
    return input.current;
  }
  if (input.hasPublishableLines) {
    return "ready_to_invoice";
  }
  if (input.hasAwaitingApproval && input.estimateSent) {
    return "awaiting_approval";
  }
  if (input.hasSquareDraft) return "draft";
  return "none";
}

export function dollarsToCents(amount: number): number {
  return Math.round(amount * 100);
}

export function centsToDollars(cents: number): number {
  return cents / 100;
}
