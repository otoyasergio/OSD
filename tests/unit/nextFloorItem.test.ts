import { describe, expect, it } from "vitest";
import { chooseNextFloorItem } from "@/lib/technician/nextFloorItem";
import type { FloorQueueItem } from "@/lib/services/technicianFloor";

function item(workOrderId: string, jobId: string, isActive = false): FloorQueueItem {
  return {
    key: `work-order-${workOrderId}`,
    kind: "job",
    job_id: jobId,
    work_order_id: workOrderId,
    work_order_number: workOrderId,
    motorcycle_label: workOrderId,
    service_label: jobId,
    title: jobId,
    subtitle: workOrderId,
    status_label: isActive ? "In Progress" : "Ready To Start",
    lane: "priority",
    is_active: isActive,
  };
}

describe("chooseNextFloorItem", () => {
  it("keeps the technician on the same motorcycle when another service remains", () => {
    const unrelatedActive = item("wo-other", "job-other", true);
    const sameMotorcycle = item("wo-current", "job-next");

    expect(
      chooseNextFloorItem(
        {
          priority: [unrelatedActive, sameMotorcycle],
          needsQc: [],
          readyToPull: [],
        },
        "wo-current"
      )
    ).toBe(sameMotorcycle);
  });

  it("falls back to the active motorcycle when the completed one is finished", () => {
    const active = item("wo-active", "job-active", true);
    expect(
      chooseNextFloorItem(
        { priority: [active], needsQc: [], readyToPull: [] },
        "wo-finished"
      )
    ).toBe(active);
  });
});
