import type { WorkOrderStatus } from "@/lib/database/types";
import type { IntakeFollowUp } from "@/lib/forms/intakeCompletion";

const TERMINAL_STATUSES: WorkOrderStatus[] = ["completed", "cancelled"];

export function getAgreementFollowUp(
  status: WorkOrderStatus,
  agreement: {
    signature_method: "digital" | "paper";
    has_paper_copy: boolean;
  } | null
): IntakeFollowUp | null {
  if (TERMINAL_STATUSES.includes(status)) return null;
  if (!agreement) return "signature";
  if (agreement.signature_method === "paper" && !agreement.has_paper_copy) {
    return "paper_copy";
  }
  return null;
}

export function getAgreementFollowUpLabel(
  followUp: IntakeFollowUp | null | undefined
): string | null {
  if (followUp === "signature") return "Signature";
  if (followUp === "paper_copy") return "Paper copy";
  return null;
}
