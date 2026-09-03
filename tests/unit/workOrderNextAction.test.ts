import { describe, expect, it } from "vitest";
import { getWorkOrderNextAction } from "@/lib/work-orders/nextAction";

describe("getWorkOrderNextAction", () => {
  it("asks to assign when no tech", () => {
    const next = getWorkOrderNextAction({
      workOrderId: "wo-1",
      status: "in_progress",
      qualityChecked: false,
      safetyChecked: false,
      readyForPickup: false,
      safety_required: false,
      safety_waived: false,
      jobs: [{ status: "in_progress", service_name_snapshot: "Oil" }],
      hasAssignedTech: false,
      inspectionCompleted: false,
    });
    expect(next?.title).toMatch(/Assign/i);
  });

  it("asks for inspection before jobs finish", () => {
    const next = getWorkOrderNextAction({
      workOrderId: "wo-1",
      status: "in_progress",
      qualityChecked: false,
      safetyChecked: false,
      readyForPickup: false,
      safety_required: false,
      safety_waived: false,
      jobs: [{ status: "in_progress", service_name_snapshot: "Oil" }],
      hasAssignedTech: true,
      inspectionCompleted: false,
    });
    expect(next?.title).toMatch(/inspection/i);
    expect(next?.href).toContain("/inspection");
  });

  it("asks for head-tech final inspection after QC on ordinary service visits", () => {
    const next = getWorkOrderNextAction({
      workOrderId: "wo-1",
      status: "quality_check",
      qualityChecked: true,
      safetyChecked: false,
      readyForPickup: false,
      safety_required: null,
      safety_waived: false,
      jobs: [{ status: "completed", service_name_snapshot: "Oil Change" }],
      hasAssignedTech: true,
      inspectionCompleted: true,
    });
    expect(next?.title).toMatch(/Final inspection/i);
  });
});
