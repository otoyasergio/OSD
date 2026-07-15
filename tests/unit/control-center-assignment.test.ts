import { describe, expect, it } from "vitest";

/**
 * Pure mirror of Control Center pool vs assigned rule used by the UI/service:
 * a bike is assigned when any active job has an assignee.
 */
function assignedTechnicianId(
  jobs: Array<{ status: string; assigned_technician_id: string | null }>
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
  return null;
}

describe("control center assignment shape", () => {
  it("treats mixed jobs as assigned to the first active assignee", () => {
    expect(
      assignedTechnicianId([
        { status: "completed", assigned_technician_id: "old" },
        { status: "in_progress", assigned_technician_id: "tech-a" },
        { status: "approved", assigned_technician_id: null },
      ])
    ).toBe("tech-a");
  });

  it("treats all-unassigned active jobs as pool", () => {
    expect(
      assignedTechnicianId([
        { status: "approved", assigned_technician_id: null },
        { status: "ready_to_start", assigned_technician_id: null },
      ])
    ).toBe(null);
  });
});
