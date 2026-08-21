import type { FloorOsSurface } from "@/lib/services/technicianFloor";
import type { PitBoardStep } from "@/lib/technician/pitBoard";

export type FloorStage = "inspect" | "work" | "proof" | "done" | "qc" | "safety";

export type FloorSpineKey = "inspect" | "work" | "proof" | "done";

export type FloorSpineNodeState = "done" | "current" | "future";

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

export function stepMatchesStage(step: PitBoardStep, stage: FloorStage): boolean {
  switch (stage) {
    case "inspect":
      return step.kind === "inspect";
    case "work":
      return step.kind === "work" || step.kind === "checklist" || step.kind === "part";
    case "proof":
      return step.kind === "proof";
    case "done":
      return step.kind === "complete";
    default:
      return false;
  }
}

/** The single open step the tech should see. Falls back to the first open step. */
export function currentPitStep(
  steps: PitBoardStep[],
  stage: FloorStage | null
): PitBoardStep | null {
  if (stage) {
    const stageOpen = steps.find(
      (step) => step.state === "open" && stepMatchesStage(step, stage)
    );
    if (stageOpen) return stageOpen;
  }
  return steps.find((step) => step.state === "open") ?? null;
}

function stageIsDone(steps: PitBoardStep[], stage: FloorSpineKey): boolean {
  const matching = steps.filter((step) => stepMatchesStage(step, stage));
  if (matching.length === 0) return false;
  return matching.every((step) => step.state !== "open");
}

export function floorSpineStates(
  steps: PitBoardStep[],
  active: FloorStage
): Record<FloorSpineKey, FloorSpineNodeState> {
  const keys: FloorSpineKey[] = ["inspect", "work", "proof", "done"];
  const result = {} as Record<FloorSpineKey, FloorSpineNodeState>;
  for (const key of keys) {
    if (key === active) {
      result[key] = "current";
    } else if (stageIsDone(steps, key)) {
      result[key] = "done";
    } else {
      result[key] = "future";
    }
  }
  return result;
}
