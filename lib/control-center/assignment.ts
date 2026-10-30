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
