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
