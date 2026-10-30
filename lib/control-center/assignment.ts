import type { WorkOrderStatus } from "@/lib/database/types";
import { isControlCenterDispatchStatus } from "@/lib/control-center/dnd";

/** Active job assignee, or the tech a finished bike was dropped onto. */
export function controlCenterTechnicianId(
  jobs: ReadonlyArray<{ status: string; assigned_technician_id: string | null }>,
  primaryTechnicianId?: string | null
): string | null {
  const activeJobs = jobs.filter(
    (job) =>
      job.status !== "cancelled" &&
      job.status !== "declined" &&
      job.status !== "completed"
  );
  if (activeJobs.length > 0) {
    for (const job of activeJobs) {
      if (job.assigned_technician_id) {
        return job.assigned_technician_id;
      }
    }
    return null;
  }
  return primaryTechnicianId || null;
}

/** Tech column for a Control Center card. Category lanes are not on a tech. */
export function controlCenterCardTechnicianId(
  status: string,
  jobs: ReadonlyArray<{ status: string; assigned_technician_id: string | null }>,
  primaryTechnicianId?: string | null
): string | null {
  if (!isControlCenterDispatchStatus(status as WorkOrderStatus)) return null;
  if (status === "ready_for_technician") {
    return controlCenterTechnicianId(jobs, null);
  }
  return controlCenterTechnicianId(jobs, primaryTechnicianId);
}
