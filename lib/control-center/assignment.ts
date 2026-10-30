import { workOrderLeftTechDocket } from "@/lib/technician/floorActionModel";

/** Active job assignee, or the tech a finished bike was dropped onto. */
export function controlCenterTechnicianId(
  jobs: ReadonlyArray<{ status: string; assigned_technician_id: string | null }>,
  primaryTechnicianId?: string | null
): string | null {
  for (const job of jobs) {
    if (
      job.status !== "cancelled" &&
      job.status !== "declined" &&
      job.status !== "completed" &&
      job.assigned_technician_id
    ) {
      return job.assigned_technician_id;
    }
  }
  return primaryTechnicianId || null;
}

/** Tech column for a Control Center card. Category lanes are not on a tech. */
export function controlCenterCardTechnicianId(
  status: string,
  jobs: ReadonlyArray<{ status: string; assigned_technician_id: string | null }>,
  primaryTechnicianId?: string | null
): string | null {
  if (workOrderLeftTechDocket(status)) return null;
  return controlCenterTechnicianId(jobs, primaryTechnicianId);
}
