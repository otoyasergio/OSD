import { describe, it, expect } from "vitest";
import {
  assignBoardColumnForTarget,
  canDragCcBike,
  isCcStageDropEnabledForRole,
  isCcStageDropId,
  isControlCenterDispatchStatus,
  partitionControlCenterDispatchBikes,
  removeWorkOrderFromControlCenterLists,
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
    expect(isCcStageDropId("complete")).toBe(true);
    expect(isCcStageDropId("pool")).toBe(false);
  });

  it("maps stage statuses to drop ids and back", () => {
    expect(stageDropIdForStatus("waiting_for_parts")).toBe("parts");
    expect(stageDropIdForStatus("quality_check")).toBe("qc");
    expect(stageDropIdForStatus("safety_check")).toBe("safety");
    expect(stageDropIdForStatus("ready_for_pickup")).toBe("pickup");
    expect(stageDropIdForStatus("completed")).toBe("complete");
    expect(stageDropIdForStatus("in_progress")).toBeNull();

    expect(statusForCcStage("parts")).toBe("waiting_for_parts");
    expect(statusForCcStage("qc")).toBe("quality_check");
    expect(statusForCcStage("safety")).toBe("safety_check");
    expect(statusForCcStage("pickup")).toBe("ready_for_pickup");
    expect(statusForCcStage("complete")).toBe("completed");
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

  it("gates stage drop lanes by role", () => {
    expect(isCcStageDropEnabledForRole("owner", "qc")).toBe(true);
    expect(isCcStageDropEnabledForRole("manager", "safety")).toBe(true);
    expect(isCcStageDropEnabledForRole("service_advisor", "parts")).toBe(true);
    expect(isCcStageDropEnabledForRole("service_advisor", "qc")).toBe(false);
    expect(isCcStageDropEnabledForRole("admin", "pickup")).toBe(false);
    expect(isCcStageDropEnabledForRole("owner", "complete")).toBe(true);
    expect(isCcStageDropEnabledForRole("manager", "complete")).toBe(true);
    expect(isCcStageDropEnabledForRole("service_advisor", "complete")).toBe(true);
    expect(isCcStageDropEnabledForRole("admin", "complete")).toBe(false);
    expect(isCcStageDropEnabledForRole("technician", "complete")).toBe(false);
  });

  it("keeps dispatch cards off stage-status bikes so a drop actually moves them", () => {
    expect(isControlCenterDispatchStatus("in_progress")).toBe(true);
    expect(isControlCenterDispatchStatus("ready_for_technician")).toBe(true);
    expect(isControlCenterDispatchStatus("open")).toBe(true);
    expect(isControlCenterDispatchStatus("waiting_for_parts")).toBe(false);
    expect(isControlCenterDispatchStatus("quality_check")).toBe(false);
    expect(isControlCenterDispatchStatus("safety_check")).toBe(false);
    expect(isControlCenterDispatchStatus("ready_for_pickup")).toBe(false);
    expect(isControlCenterDispatchStatus("completed")).toBe(false);
  });

  it("partitions stage-status bikes out of the pool and tech cards", () => {
    const { pool, assignedByTech } = partitionControlCenterDispatchBikes(
      [
        { work_order_id: "wo-pool", status: "in_progress", technician_id: null },
        { work_order_id: "wo-tech", status: "in_progress", technician_id: "tech-a" },
        { work_order_id: "wo-parts", status: "waiting_for_parts", technician_id: null },
        { work_order_id: "wo-qc", status: "quality_check", technician_id: "tech-a" },
      ],
      new Set(["tech-a"])
    );

    expect(pool.map((bike) => bike.work_order_id)).toEqual(["wo-pool"]);
    expect(assignedByTech.get("tech-a")?.map((bike) => bike.work_order_id)).toEqual([
      "wo-tech",
    ]);
  });

  it("maps pool vs tech drops to board columns so stage cards can return to dispatch", () => {
    expect(assignBoardColumnForTarget("pool", "pool")).toBe("ready");
    expect(assignBoardColumnForTarget("tech-a", "pool")).toBe("in_progress");
  });

  it("removes a card from every list so it lives in only one place after a move", () => {
    const result = removeWorkOrderFromControlCenterLists({
      workOrderId: "wo-1",
      pool: [{ work_order_id: "wo-1" }, { work_order_id: "wo-2" }],
      techs: [{ assigned_bikes: [{ work_order_id: "wo-1" }, { work_order_id: "wo-3" }] }],
      stages: {
        parts: [{ work_order_id: "wo-1" }],
        qc: [{ work_order_id: "wo-4" }],
        safety: [],
        pickup: [],
        complete: [],
      },
    });

    expect(result.pool.map((bike) => bike.work_order_id)).toEqual(["wo-2"]);
    expect(result.techs[0].assigned_bikes.map((bike) => bike.work_order_id)).toEqual([
      "wo-3",
    ]);
    expect(result.stages.parts).toEqual([]);
    expect(result.stages.qc.map((bike) => bike.work_order_id)).toEqual(["wo-4"]);
  });

  it("gates assign vs stage drag affordances", () => {
    expect(
      canDragCcBike("service_advisor", "in_progress", {
        mode: "assign",
        canAssign: true,
      })
    ).toBe(true);
    expect(
      canDragCcBike("admin", "in_progress", {
        mode: "assign",
        canAssign: false,
      })
    ).toBe(false);
    expect(
      canDragCcBike("service_advisor", "in_progress", {
        mode: "stage",
        canAssign: true,
      })
    ).toBe(true);
    expect(
      canDragCcBike("admin", "in_progress", {
        mode: "stage",
        canAssign: false,
      })
    ).toBe(false);
  });
});
