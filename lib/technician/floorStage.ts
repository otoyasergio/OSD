import type { FloorOsSurface } from "@/lib/services/technicianFloor";

export type FloorStage = "inspect" | "work" | "proof" | "done" | "qc" | "safety";

export function deriveDefaultStage(surface: FloorOsSurface): FloorStage {
  if (surface.is_safety && surface.can_safety) return "safety";
  if (surface.is_qc && surface.qc_assignee_is_me && !surface.job_id) return "qc";
  if (surface.can_pull) return "work";
  if (!surface.inspection_complete) return "inspect";
  const checklistOpen = surface.checklist.some((item) => !item.checked_at);
  const partsOpen = surface.parts.some((part) => part.can_install);
  if (checklistOpen || partsOpen) return "work";
  if (surface.proof_count < 1 && !surface.has_proof_exception) return "proof";
  return "done";
}
