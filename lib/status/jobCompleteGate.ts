export type JobCompleteGateInput = {
  checklistItems: Array<{ checked_at: string | null }>;
  parts: Array<{ status: string }>;
  proofPhotoCount: number;
  hasProofException: boolean;
  /** When false, block complete (matches server inspectionGate). */
  inspectionComplete?: boolean;
};

export type JobCompleteGateResult =
  { ok: true } | { ok: false; reason: string; code: string };

const PARTS_OK = new Set(["installed", "not_required", "cancelled"]);

export function evaluateJobCompleteGate(
  input: JobCompleteGateInput
): JobCompleteGateResult {
  if (input.inspectionComplete === false) {
    return {
      ok: false,
      code: "INSPECTION_NOT_COMPLETED",
      reason: "Complete the inspection report first.",
    };
  }

  if (input.checklistItems.length === 0) {
    return {
      ok: false,
      code: "CHECKLIST_REQUIRED",
      reason: "Complete the standard work checklist first.",
    };
  }
  if (input.checklistItems.some((item) => !item.checked_at)) {
    return {
      ok: false,
      code: "CHECKLIST_INCOMPLETE",
      reason: "Check all checklist items before completing.",
    };
  }

  const blockingParts = input.parts.filter((part) => !PARTS_OK.has(part.status));
  if (blockingParts.length > 0) {
    return {
      ok: false,
      code: "PARTS_NOT_INSTALLED",
      reason: "Install or clear all parts before completing.",
    };
  }

  if (input.proofPhotoCount < 1 && !input.hasProofException) {
    return {
      ok: false,
      code: "PROOF_REQUIRED",
      reason: "Add an after photo or a proof exception note.",
    };
  }

  return { ok: true };
}
