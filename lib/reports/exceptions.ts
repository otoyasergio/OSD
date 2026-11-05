import type { WorkOrderStatus } from "@/lib/database/types";
import type { BillingStage } from "@/lib/billing/stages";
import { isJobIdleAtLeastThreeDays } from "@/lib/control-center/atRisk";

export type ShopExceptionKind =
  | "stalled"
  | "promise_missed"
  | "unbilled"
  | "unpaid"
  | "thin_margin"
  | "supplier_credit";

const FINISHED: WorkOrderStatus[] = ["ready_for_pickup", "in_storage", "completed"];
const UNBILLED: BillingStage[] = [
  "none",
  "draft",
  "awaiting_approval",
  "ready_to_invoice",
];
const STALL_STATUSES: WorkOrderStatus[] = [
  "open",
  "inspection_in_progress",
  "waiting_for_customer_approval",
  "waiting_for_parts",
  "ready_for_technician",
  "in_progress",
  "quality_check",
  "safety_check",
];

export function classifyShopExceptions(input: {
  status: WorkOrderStatus;
  lastJobActivityAt: string | null;
  estimatedCompletion: string | null;
  billingStage: BillingStage;
  billingAmountCents: number;
  billingCollectedCents: number;
  partsMarginThin: boolean;
  supplierCreditCents: number;
  now: string;
}): ShopExceptionKind[] {
  const kinds: ShopExceptionKind[] = [];
  const now = new Date(input.now);
  const closed = input.status === "completed" || input.status === "cancelled";

  if (
    STALL_STATUSES.includes(input.status) &&
    isJobIdleAtLeastThreeDays(input.lastJobActivityAt, now)
  ) {
    kinds.push("stalled");
  }

  if (
    !closed &&
    input.status !== "in_storage" &&
    input.status !== "insurance" &&
    input.estimatedCompletion &&
    new Date(input.estimatedCompletion).getTime() < now.getTime()
  ) {
    kinds.push("promise_missed");
  }

  if (FINISHED.includes(input.status) && UNBILLED.includes(input.billingStage)) {
    kinds.push("unbilled");
  }

  if (
    input.billingStage === "invoiced" &&
    input.billingCollectedCents < input.billingAmountCents
  ) {
    kinds.push("unpaid");
  }

  if (input.partsMarginThin) kinds.push("thin_margin");
  if (input.supplierCreditCents > 0) kinds.push("supplier_credit");
  return kinds;
}
