export type PickupLeaveGateInput = {
  inspectionComplete: boolean;
  qualityChecked: boolean;
  safetyRequired: boolean;
  safetyChecked: boolean;
  checkoutEvidenceRequired?: boolean;
  checkoutEvidenceComplete?: boolean;
  checkoutEvidenceOverridden?: boolean;
};

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
  if (!input.inspectionComplete) return "INSPECTION_REQUIRED_BEFORE_PICKUP";
  if (!input.qualityChecked) return "QC_REQUIRED";
  if (input.safetyRequired && !input.safetyChecked) {
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
