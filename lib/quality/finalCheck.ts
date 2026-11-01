export type RoadTestResult = "pass" | "fail" | "not_performed";

export type FinalCheckInput = {
  technicianUserId: string;
  verifierUserId: string;
  roadTestResult: RoadTestResult;
  mileageOut: number | null;
};

export function validateFinalCheck(
  input: FinalCheckInput
): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!input.technicianUserId || !input.verifierUserId) {
    errors.push("BOTH_ACCOUNTS_REQUIRED");
  } else if (input.technicianUserId === input.verifierUserId) {
    errors.push("VERIFIER_MUST_DIFFER");
  }
  if (!["pass", "fail", "not_performed"].includes(input.roadTestResult)) {
    errors.push("ROAD_TEST_REQUIRED");
  }
  if (input.mileageOut != null && (!Number.isFinite(input.mileageOut) || input.mileageOut < 0)) {
    errors.push("MILEAGE_INVALID");
  }
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true };
}

/**
 * Release stays blocked while declined safety repairs are unacknowledged.
 * The acknowledgment records the items. It does not waive responsibility.
 */
export function declinedSafetyReleaseBlock(input: {
  declinedItems: string[];
  acknowledged: boolean;
}): boolean {
  return input.declinedItems.length > 0 && !input.acknowledged;
}
