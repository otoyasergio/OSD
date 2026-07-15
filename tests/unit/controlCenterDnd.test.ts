import { describe, it, expect } from "vitest";
import {
  isCcStageDropId,
  resolveControlCenterDropTarget,
  stageDropIdForStatus,
  statusForCcStage,
} from "@/lib/control-center/dnd";

describe("control center dnd helpers", () => {
  it("recognizes stage drop ids", () => {
    expect(isCcStageDropId("parts")).toBe(true);
    expect(isCcStageDropId("qc")).toBe(true);
    expect(isCcStageDropId("safety")).toBe(true);
    expect(isCcStageDropId("pickup")).toBe(true);
    expect(isCcStageDropId("pool")).toBe(false);
  });

  it("maps stage statuses to drop ids and back", () => {
    expect(stageDropIdForStatus("waiting_for_parts")).toBe("parts");
    expect(stageDropIdForStatus("quality_check")).toBe("qc");
    expect(stageDropIdForStatus("safety_check")).toBe("safety");
    expect(stageDropIdForStatus("ready_for_pickup")).toBe("pickup");
    expect(stageDropIdForStatus("in_progress")).toBeNull();

    expect(statusForCcStage("parts")).toBe("waiting_for_parts");
    expect(statusForCcStage("qc")).toBe("quality_check");
    expect(statusForCcStage("safety")).toBe("safety_check");
    expect(statusForCcStage("pickup")).toBe("ready_for_pickup");
  });

  it("resolves direct container ids", () => {
    expect(
      resolveControlCenterDropTarget({
        overId: "pool",
        poolId: "pool",
        techIds: ["tech-a"],
        containerForWorkOrder: () => null,
      })
    ).toBe("pool");

    expect(
      resolveControlCenterDropTarget({
        overId: "qc",
        poolId: "pool",
        techIds: ["tech-a"],
        containerForWorkOrder: () => null,
      })
    ).toBe("qc");

    expect(
      resolveControlCenterDropTarget({
        overId: "tech-a",
        poolId: "pool",
        techIds: ["tech-a"],
        containerForWorkOrder: () => null,
      })
    ).toBe("tech-a");
  });

  it("resolves drops onto bike cards to that bike's container", () => {
    expect(
      resolveControlCenterDropTarget({
        overId: "wo-1",
        poolId: "pool",
        techIds: ["tech-a"],
        containerForWorkOrder: (id) => (id === "wo-1" ? "parts" : null),
      })
    ).toBe("parts");
  });

  it("strips stage: prefix when resolving card drops", () => {
    expect(
      resolveControlCenterDropTarget({
        overId: "stage:wo-1",
        poolId: "pool",
        techIds: ["tech-a"],
        containerForWorkOrder: (id) => (id === "wo-1" ? "qc" : null),
      })
    ).toBe("qc");
  });
});
