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
});
