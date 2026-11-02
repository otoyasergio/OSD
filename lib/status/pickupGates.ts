import {
  storageLeaveBlockCode,
  type StorageChecklist,
  type StorageLeaveBlockCode,
} from "@/lib/storage/checklist";

export type PickupLeaveGateInput = {
  inspectionComplete: boolean;
  qualityChecked: boolean;
  safetyRequired: boolean;
  safetyChecked: boolean;
  checkoutEvidenceRequired?: boolean;
  checkoutEvidenceComplete?: boolean;
  checkoutEvidenceOverridden?: boolean;
  /** Owner board moves may place a bike without a peer quality check. */
  waiveQualityCheck?: boolean;
  /** Complete drop for a bike that already left may skip the safety check. */
  waiveSafetyCheck?: boolean;
  /** Owner board moves ignore every leave gate. */
  skipAllGates?: boolean;
};

export const OWNER_SKIP_CHECKS_REASON = "Owner skipped the usual checks.";

export type PickupLeaveBlockReason =
  | "INSPECTION_REQUIRED_BEFORE_PICKUP"
  | "QC_REQUIRED"
  | "SAFETY_REQUIRED_BEFORE_PICKUP"
  | "CHECKOUT_EVIDENCE_REQUIRED";

/**
 * Why a visit cannot leave for customer pickup. Inspection, peer QC, and
 * head-tech safety all have to pass unless office waived safety. Checkout
 * evidence is last so existing gates keep precedence.
 */
export function pickupLeaveBlockReason(
  input: PickupLeaveGateInput
): PickupLeaveBlockReason | null {
  if (input.skipAllGates) return null;
  if (!input.inspectionComplete) return "INSPECTION_REQUIRED_BEFORE_PICKUP";
  if (!input.qualityChecked && !input.waiveQualityCheck) return "QC_REQUIRED";
  if (input.safetyRequired && !input.safetyChecked && !input.waiveSafetyCheck) {
    return "SAFETY_REQUIRED_BEFORE_PICKUP";
  }
  if (
    input.checkoutEvidenceRequired &&
    !input.checkoutEvidenceComplete &&
    !input.checkoutEvidenceOverridden
  ) {
    return "CHECKOUT_EVIDENCE_REQUIRED";
  }
  return null;
}

export type StorageLeaveGateInput = Pick<
  StorageChecklist,
  "inspectionDone" | "awaitingApproval" | "unfinishedApproved" | "partsOutstanding"
>;

/**
 * Storage keeps the bike in the building after the same service path as any
 * other bike: arrival inspection, a decided estimate, and finished approved
 * work. Final inspection, safety, and checkout photos are for a bike that is
 * leaving. No role can skip this gate.
 */
export function storageLeaveBlockReason(
  input: StorageLeaveGateInput
): StorageLeaveBlockCode | null {
  return storageLeaveBlockCode(input);
}
