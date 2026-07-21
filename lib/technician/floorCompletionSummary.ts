import type { FloorOsSurface } from "@/lib/services/technicianFloor";
import {
  isFloorJobFinished,
  isPerformWorkChecklistTitle,
} from "@/lib/technician/pitBoard";

export type FloorCompletionSummary = {
  service_names: string[];
  checklist_done: string[];
  inspection_complete: boolean;
  parts_installed_count: number;
  pending_recommendations: FloorOsSurface["pending_recommendations"];
};

export function buildFloorCompletionSummary(
  surface: FloorOsSurface
): FloorCompletionSummary | null {
  if (
    !isFloorJobFinished({
      board_status: surface.board_status,
      job_status: surface.job_status,
      completed_at: surface.completed_at,
    })
  ) {
    return null;
  }

  const completedMine = surface.jobs
    .filter((job) => job.assigned_to_me && job.status === "completed")
    .map((job) => job.service_name);
  const service_names =
    completedMine.length > 0
      ? completedMine
      : surface.service_name
        ? [surface.service_name]
        : [];

  const checklist_done = surface.checklist
    .filter((item) => item.checked_at && !isPerformWorkChecklistTitle(item.title))
    .map((item) => item.title);

  const parts_installed_count = surface.parts.filter(
    (part) => part.status === "installed"
  ).length;

  return {
    service_names,
    checklist_done,
    inspection_complete: surface.inspection_complete,
    parts_installed_count,
    pending_recommendations: surface.pending_recommendations,
  };
}
