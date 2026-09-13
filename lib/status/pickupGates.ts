export type PickupLeaveGateInput = {
  inspectionComplete: boolean;
  qualityChecked: boolean;
  safetyRequired: boolean;
  safetyChecked: boolean;
};

export type PickupLeaveBlockReason =
  "INSPECTION_REQUIRED_BEFORE_PICKUP" | "QC_REQUIRED" | "SAFETY_REQUIRED_BEFORE_PICKUP";

/**
 * Why a visit cannot leave for customer pickup. Inspection, peer QC, and
 * head-tech safety all have to pass unless office waived safety.
 */
export function pickupLeaveBlockReason(
  input: PickupLeaveGateInput
): PickupLeaveBlockReason | null {
  if (!input.inspectionComplete) return "INSPECTION_REQUIRED_BEFORE_PICKUP";
  if (!input.qualityChecked) return "QC_REQUIRED";
  if (input.safetyRequired && !input.safetyChecked) {
    return "SAFETY_REQUIRED_BEFORE_PICKUP";
  }
  return null;
}
