import type { UserRole, WorkOrderStatus } from "@/lib/database/types";
import {
  canDragWorkOrderOnBoard,
  canDropInColumn,
  getTargetStatusForColumn,
} from "@/lib/status/transitions";

/** Droppable ids for Control Center stage carousels (Shop Board column ids). */
export const CC_STAGE_DROP_IDS = ["parts", "qc", "safety", "pickup", "complete"] as const;

export type CcStageDropId = (typeof CC_STAGE_DROP_IDS)[number];

export function isCcStageDropId(id: string): id is CcStageDropId {
  return (CC_STAGE_DROP_IDS as readonly string[]).includes(id);
}

export function stageDropIdForStatus(status: WorkOrderStatus): CcStageDropId | null {
  switch (status) {
    case "waiting_for_parts":
      return "parts";
    case "quality_check":
      return "qc";
    case "safety_check":
      return "safety";
    case "ready_for_pickup":
      return "pickup";
    case "completed":
      return "complete";
    default:
      return null;
  }
}

export function statusForCcStage(stageId: CcStageDropId): WorkOrderStatus {
  const status = getTargetStatusForColumn(stageId);
  if (!status) {
    throw new Error(`Missing target status for Control Center stage ${stageId}`);
  }
  return status;
}

/** True when a bike should sit on the pool / tech grid, not a stage carousel. */
export function isControlCenterDispatchStatus(status: WorkOrderStatus): boolean {
  return stageDropIdForStatus(status) === null;
}

/** Board column used when a stage card is dropped back onto pool or a tech. */
export function assignBoardColumnForTarget(
  targetId: string,
  poolId: string
): "ready" | "in_progress" {
  return targetId === poolId ? "ready" : "in_progress";
}

export function partitionControlCenterDispatchBikes<
  T extends { status: WorkOrderStatus; technician_id: string | null },
>(
  bikes: T[],
  knownTechIds: ReadonlySet<string>
): { pool: T[]; assignedByTech: Map<string, T[]> } {
  const assignedByTech = new Map<string, T[]>();
  const pool: T[] = [];

  for (const bike of bikes) {
    if (!isControlCenterDispatchStatus(bike.status)) continue;
    if (bike.technician_id && knownTechIds.has(bike.technician_id)) {
      const list = assignedByTech.get(bike.technician_id) ?? [];
      list.push(bike);
      assignedByTech.set(bike.technician_id, list);
    } else {
      pool.push(bike.technician_id ? { ...bike, technician_id: null } : bike);
    }
  }

  return { pool, assignedByTech };
}

/** Strip a work order from pool, tech cards, and every stage so it can sit in one place. */
export function removeWorkOrderFromControlCenterLists<
  TBike extends { work_order_id: string },
  TTech extends { assigned_bikes: TBike[] },
  TStage extends { work_order_id: string },
>(input: {
  workOrderId: string;
  pool: TBike[];
  techs: TTech[];
  stages: Record<CcStageDropId, TStage[]>;
}): { pool: TBike[]; techs: TTech[]; stages: Record<CcStageDropId, TStage[]> } {
  const { workOrderId } = input;
  return {
    pool: input.pool.filter((bike) => bike.work_order_id !== workOrderId),
    techs: input.techs.map((tech) => ({
      ...tech,
      assigned_bikes: tech.assigned_bikes.filter(
        (bike) => bike.work_order_id !== workOrderId
      ),
    })),
    stages: {
      parts: input.stages.parts.filter((bike) => bike.work_order_id !== workOrderId),
      qc: input.stages.qc.filter((bike) => bike.work_order_id !== workOrderId),
      safety: input.stages.safety.filter((bike) => bike.work_order_id !== workOrderId),
      pickup: input.stages.pickup.filter((bike) => bike.work_order_id !== workOrderId),
      complete: input.stages.complete.filter(
        (bike) => bike.work_order_id !== workOrderId
      ),
    },
  };
}

/**
 * Whether a stage lane should accept drops for this role.
 * QC / safety stay owner/manager-only via canDropInColumn.
 */
export function isCcStageDropEnabledForRole(
  role: UserRole,
  stageId: CcStageDropId
): boolean {
  // Complete accepts ready-for-pickup bikes; probe that status for advisors.
  const probeStatus: WorkOrderStatus =
    stageId === "complete" ? "ready_for_pickup" : "in_progress";
  return canDropInColumn(role, stageId, probeStatus);
}

/** Pool / tech cards: assign drag. Stage cards: board status drag. */
export function canDragCcBike(
  role: UserRole,
  status: WorkOrderStatus,
  options: { mode: "assign" | "stage"; canAssign: boolean }
): boolean {
  if (options.mode === "assign") {
    return options.canAssign;
  }
  return canDragWorkOrderOnBoard(role, status, false);
}

/**
 * Resolve a dnd-kit `over.id` to a real drop container.
 * Dropping onto another bike card resolves to that bike's container.
 */
export function normalizeControlCenterDragId(id: string): string {
  return id.startsWith("stage:") ? id.slice("stage:".length) : id;
}

export function resolveControlCenterDropTarget(input: {
  overId: string;
  poolId: string;
  techIds: ReadonlyArray<string>;
  /** Returns pool id, tech user id, or stage drop id for a work order. */
  containerForWorkOrder: (workOrderId: string) => string | null;
}): string | null {
  const { overId, poolId, techIds, containerForWorkOrder } = input;
  if (overId === poolId) return poolId;
  if (isCcStageDropId(overId)) return overId;
  if (techIds.includes(overId)) return overId;

  // Dropped on a bike card (pool/tech id or stage:<wo>) — use that bike's container.
  const workOrderId = normalizeControlCenterDragId(overId);
  return containerForWorkOrder(workOrderId);
}
