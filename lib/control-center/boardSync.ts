import {
  isCcStageDropId,
  removeWorkOrderFromControlCenterLists,
  type CcStageDropId,
} from "@/lib/control-center/dnd";

/**
 * In-flight Control Center drop. Kept in a ref so a stale `router.refresh()`
 * that was already in flight before the drop cannot snap the card back.
 */
export type ControlCenterPendingMove<
  TBike extends { work_order_id: string },
  TStage extends { work_order_id: string },
> = {
  workOrderId: string;
  containerId: string;
  dispatchBike: TBike | null;
  stageBike: TStage | null;
};

export function shouldDeferControlCenterServerSnapshot(dragging: boolean): boolean {
  return dragging;
}

export function snapshotHasPendingPlacement<
  TBike extends { work_order_id: string },
  TStage extends { work_order_id: string },
  TTech extends { user_id: string; assigned_bikes: TBike[] },
>(input: {
  pending: ControlCenterPendingMove<TBike, TStage>;
  pool: TBike[];
  techs: TTech[];
  stages: Record<CcStageDropId, TStage[]>;
  poolId: string;
}): boolean {
  const { pending, pool, techs, stages, poolId } = input;
  const { workOrderId, containerId } = pending;
  if (isCcStageDropId(containerId)) {
    return stages[containerId].some((bike) => bike.work_order_id === workOrderId);
  }
  if (containerId === poolId) {
    return pool.some((bike) => bike.work_order_id === workOrderId);
  }
  const tech = techs.find((row) => row.user_id === containerId);
  return Boolean(tech?.assigned_bikes.some((bike) => bike.work_order_id === workOrderId));
}

export function overlayPendingControlCenterMove<
  TBike extends { work_order_id: string },
  TStage extends { work_order_id: string },
  TTech extends { user_id: string; assigned_bikes: TBike[] },
>(input: {
  pending: ControlCenterPendingMove<TBike, TStage>;
  pool: TBike[];
  techs: TTech[];
  stages: Record<CcStageDropId, TStage[]>;
  poolId: string;
}): { pool: TBike[]; techs: TTech[]; stages: Record<CcStageDropId, TStage[]> } {
  const { pending, poolId } = input;
  const lists = removeWorkOrderFromControlCenterLists({
    workOrderId: pending.workOrderId,
    pool: input.pool,
    techs: input.techs,
    stages: input.stages,
  });

  if (isCcStageDropId(pending.containerId)) {
    if (!pending.stageBike) return lists;
    const stageId = pending.containerId;
    return {
      ...lists,
      stages: {
        ...lists.stages,
        [stageId]: [pending.stageBike, ...lists.stages[stageId]],
      },
    };
  }

  if (!pending.dispatchBike) return lists;
  const dispatchBike = pending.dispatchBike;

  if (pending.containerId === poolId) {
    return { ...lists, pool: [dispatchBike, ...lists.pool] };
  }

  return {
    ...lists,
    techs: lists.techs.map((tech) =>
      tech.user_id === pending.containerId
        ? {
            ...tech,
            assigned_bikes: [...tech.assigned_bikes, dispatchBike],
          }
        : tech
    ),
  };
}

export function collectControlCenterWorkOrderIds<
  TBike extends { work_order_id: string },
  TStage extends { work_order_id: string },
  TTech extends { assigned_bikes: TBike[] },
>(input: {
  pool: TBike[];
  techs: TTech[];
  stages: Record<CcStageDropId, TStage[]>;
  pendingWorkOrderId?: string | null;
}): Set<string> {
  const ids = new Set<string>();
  for (const bike of input.pool) ids.add(bike.work_order_id);
  for (const tech of input.techs) {
    for (const bike of tech.assigned_bikes) ids.add(bike.work_order_id);
  }
  for (const items of Object.values(input.stages)) {
    for (const bike of items) ids.add(bike.work_order_id);
  }
  if (input.pendingWorkOrderId) ids.add(input.pendingWorkOrderId);
  return ids;
}

export function workOrderIdFromJobRealtimePayload(payload: {
  new?: Record<string, unknown> | null;
  old?: Record<string, unknown> | null;
}): string | null {
  const fromNew =
    payload.new && typeof payload.new.work_order_id === "string"
      ? payload.new.work_order_id
      : null;
  if (fromNew) return fromNew;
  const fromOld =
    payload.old && typeof payload.old.work_order_id === "string"
      ? payload.old.work_order_id
      : null;
  return fromOld;
}

/**
 * The `job` table has no location_id. Ignore other shops' writes so Control
 * Center does not `router.refresh()` on every checklist tick in the database.
 */
export function shouldRefreshControlCenterForJobChange(
  workOrderId: string | null,
  knownWorkOrderIds: ReadonlySet<string>
): boolean {
  return Boolean(workOrderId && knownWorkOrderIds.has(workOrderId));
}

/**
 * dnd-kit auto-scroll prefers the nearest overflow box. Stage carousels are
 * overflow-x only; scrolling those instead of the page makes Complete
 * unreachable and the card appears to jump back.
 *
 * Use content size, not computed overflow: `overflow-x: auto` with default
 * `overflow-y: visible` computes to `auto/auto`.
 */
export function isHorizontalOnlyScrollContainer(input: {
  scrollWidth: number;
  clientWidth: number;
  scrollHeight: number;
  clientHeight: number;
}): boolean {
  const canScrollX = input.scrollWidth > input.clientWidth + 1;
  const canScrollY = input.scrollHeight > input.clientHeight + 1;
  return canScrollX && !canScrollY;
}

export function canAutoScrollControlCenter(element: Element): boolean {
  if (!(element instanceof HTMLElement)) return true;
  return !isHorizontalOnlyScrollContainer({
    scrollWidth: element.scrollWidth,
    clientWidth: element.clientWidth,
    scrollHeight: element.scrollHeight,
    clientHeight: element.clientHeight,
  });
}
