export const SAFETY_INSPECTION_SERVICE_NAME = "Safety Inspection";

export type SafetyRequirementJob = {
  status: string;
  service_name_snapshot?: string | null;
};

export type SafetyRequirementInput = {
  safety_required: boolean | null;
  safety_waived: boolean;
  /** Kept so every caller can pass the same visit snapshot. */
  jobs: SafetyRequirementJob[];
};

/** True unless the office has waived head-tech safety after QC. */
export function isSafetyRequired(input: SafetyRequirementInput): boolean {
  if (input.safety_waived) return false;
  return true;
}
