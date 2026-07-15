export const SAFETY_INSPECTION_SERVICE_NAME = "Safety Inspection";

export type SafetyRequirementJob = {
  status: string;
  service_name_snapshot?: string | null;
};

export type SafetyRequirementInput = {
  safety_required: boolean | null;
  safety_waived: boolean;
  jobs: SafetyRequirementJob[];
};

/** True when the visit must pass Head Tech safety after QC. */
export function isSafetyRequired(input: SafetyRequirementInput): boolean {
  if (input.safety_waived) return false;
  if (input.safety_required === true) return true;
  return input.jobs.some(
    (job) =>
      job.status !== "cancelled" &&
      job.status !== "declined" &&
      job.service_name_snapshot === SAFETY_INSPECTION_SERVICE_NAME
  );
}
