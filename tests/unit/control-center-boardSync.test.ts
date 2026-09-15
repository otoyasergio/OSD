import { describe, expect, it } from "vitest";
import {
  collectControlCenterWorkOrderIds,
  isHorizontalOnlyScrollContainer,
  overlayPendingControlCenterMove,
  shouldDeferControlCenterServerSnapshot,
  shouldRefreshControlCenterForJobChange,
  snapshotHasPendingPlacement,
  workOrderIdFromJobRealtimePayload,
  type ControlCenterPendingMove,
} from "@/lib/control-center/boardSync";
import type { CcStageDropId } from "@/lib/control-center/dnd";

type Bike = { work_order_id: string };

function emptyStages(): Record<CcStageDropId, Bike[]> {
  return { parts: [], qc: [], safety: [], pickup: [], complete: [] };
}

describe("control center board sync", () => {
  it("defers server snapshots while a drag is active", () => {
    expect(shouldDeferControlCenterServerSnapshot(true)).toBe(true);
    expect(shouldDeferControlCenterServerSnapshot(false)).toBe(false);
  });

  it("treats a stale pickup snapshot as missing the complete placement", () => {
    const pending: ControlCenterPendingMove<Bike, Bike> = {
      workOrderId: "wo-1",
      containerId: "complete",
      dispatchBike: null,
      stageBike: { work_order_id: "wo-1" },
    };
    expect(
      snapshotHasPendingPlacement({
        pending,
        pool: [],
        techs: [{ user_id: "tech-a", assigned_bikes: [] as Bike[] }],
        stages: { ...emptyStages(), pickup: [{ work_order_id: "wo-1" }] },
        poolId: "pool",
      })
    ).toBe(false);
  });

  it("confirms once the complete lane contains the dropped bike", () => {
    const pending: ControlCenterPendingMove<Bike, Bike> = {
      workOrderId: "wo-1",
      containerId: "complete",
      dispatchBike: null,
      stageBike: { work_order_id: "wo-1" },
    };
    expect(
      snapshotHasPendingPlacement({
        pending,
        pool: [],
        techs: [],
        stages: { ...emptyStages(), complete: [{ work_order_id: "wo-1" }] },
        poolId: "pool",
      })
    ).toBe(true);
  });

  it("keeps a complete drop on top of a stale server snapshot that still has pickup", () => {
    const pending: ControlCenterPendingMove<Bike, Bike> = {
      workOrderId: "wo-1",
      containerId: "complete",
      dispatchBike: null,
      stageBike: { work_order_id: "wo-1" },
    };
    const result = overlayPendingControlCenterMove({
      pending,
      pool: [],
      techs: [{ user_id: "tech-a", assigned_bikes: [{ work_order_id: "wo-1" }] }],
      stages: { ...emptyStages(), pickup: [{ work_order_id: "wo-1" }] },
      poolId: "pool",
    });

    expect(result.techs[0]?.assigned_bikes).toEqual([]);
    expect(result.stages.pickup).toEqual([]);
    expect(result.stages.complete.map((bike) => bike.work_order_id)).toEqual(["wo-1"]);
  });

  it("ignores job realtime for work orders that are not on this board", () => {
    expect(
      shouldRefreshControlCenterForJobChange("wo-other", new Set(["wo-1", "wo-2"]))
    ).toBe(false);
    expect(shouldRefreshControlCenterForJobChange("wo-1", new Set(["wo-1"]))).toBe(true);
    expect(shouldRefreshControlCenterForJobChange(null, new Set(["wo-1"]))).toBe(false);
  });

  it("reads work_order_id from job insert/update/delete payloads", () => {
    expect(workOrderIdFromJobRealtimePayload({ new: { work_order_id: "wo-1" } })).toBe(
      "wo-1"
    );
    expect(
      workOrderIdFromJobRealtimePayload({
        new: null,
        old: { work_order_id: "wo-2" },
      })
    ).toBe("wo-2");
    expect(
      workOrderIdFromJobRealtimePayload({ new: { status: "completed" } })
    ).toBeNull();
  });

  it("keeps a dispatch drop on a tech when the server snapshot still has the pool", () => {
    const pending: ControlCenterPendingMove<Bike, Bike> = {
      workOrderId: "wo-1",
      containerId: "tech-a",
      dispatchBike: { work_order_id: "wo-1" },
      stageBike: null,
    };
    const result = overlayPendingControlCenterMove({
      pending,
      pool: [{ work_order_id: "wo-1" }],
      techs: [{ user_id: "tech-a", assigned_bikes: [] as Bike[] }],
      stages: emptyStages(),
      poolId: "pool",
    });
    expect(result.pool).toEqual([]);
    expect(result.techs[0]?.assigned_bikes.map((bike) => bike.work_order_id)).toEqual([
      "wo-1",
    ]);
  });

  it("includes the in-flight drop when collecting known work order ids", () => {
    const ids = collectControlCenterWorkOrderIds({
      pool: [{ work_order_id: "wo-pool" }],
      techs: [{ assigned_bikes: [{ work_order_id: "wo-tech" }] }],
      stages: { ...emptyStages(), pickup: [{ work_order_id: "wo-pickup" }] },
      pendingWorkOrderId: "wo-pending",
    });
    expect([...ids].sort()).toEqual(["wo-pending", "wo-pickup", "wo-pool", "wo-tech"]);
  });

  it("does not auto-scroll horizontal stage carousels", () => {
    expect(
      isHorizontalOnlyScrollContainer({
        scrollWidth: 800,
        clientWidth: 320,
        scrollHeight: 140,
        clientHeight: 140,
      })
    ).toBe(true);
    expect(
      isHorizontalOnlyScrollContainer({
        scrollWidth: 320,
        clientWidth: 320,
        scrollHeight: 2000,
        clientHeight: 600,
      })
    ).toBe(false);
  });
});
