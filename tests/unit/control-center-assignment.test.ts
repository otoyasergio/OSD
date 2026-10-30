import { describe, expect, it } from "vitest";
import { controlCenterTechnicianId } from "@/lib/control-center/assignment";

function assignedTechnicianId(
  jobs: Array<{ status: string; assigned_technician_id: string | null }>,
  primaryTechnicianId?: string | null
): string | null {
  return controlCenterTechnicianId(jobs, primaryTechnicianId);
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

  it("keeps a finished bike on the tech it was dropped onto", () => {
    expect(
      assignedTechnicianId(
        [{ status: "completed", assigned_technician_id: "old" }],
        "tech-b"
      )
    ).toBe("tech-b");
  });
});
