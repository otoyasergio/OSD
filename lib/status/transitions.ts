import type { UserRole, WorkOrderStatus } from "@/lib/database/types";
import {
  canEditWorkOrder,
  canOverrideWorkOrderStatus,
} from "@/lib/permissions";
import type { SHOP_BOARD_COLUMNS } from "@/lib/status/pipeline";

export type ShopBoardColumnId = (typeof SHOP_BOARD_COLUMNS)[number]["id"];

/** Primary status applied when a card is dropped into a board column. */
const COLUMN_TARGET_STATUS: Record<ShopBoardColumnId, WorkOrderStatus | null> = {
  intake: "open",
  inspection: "inspection_in_progress",
  approval: "waiting_for_customer_approval",
  parts: "waiting_for_parts",
  ready: "ready_for_technician",
  in_progress: "in_progress",
  qc: "quality_check",
  pickup: "ready_for_pickup",
  // Hold/cancel are detail-page actions only — not board drops.
  on_hold: null,
};

export function getTargetStatusForColumn(
  columnId: string
): WorkOrderStatus | null {
  if (!(columnId in COLUMN_TARGET_STATUS)) return null;
  return COLUMN_TARGET_STATUS[columnId as ShopBoardColumnId];
}

export function isBoardDraggableStatus(status: WorkOrderStatus): boolean {
  return status !== "completed" && status !== "cancelled";
}

/**
 * Client/server permission check for dropping a card into a column.
 * QC job-completion gate is enforced on the server only.
 */
export function canDropInColumn(
  role: UserRole,
  columnId: string,
  currentStatus: WorkOrderStatus
): boolean {
  if (!isBoardDraggableStatus(currentStatus)) return false;

  const target = getTargetStatusForColumn(columnId);
  if (target === null) return false;
  if (target === currentStatus) return false;

  // on_hold cards: only managers/owners can move them off hold via board
  // (resume-style). Dropping *into* on_hold is rejected above (null target).
  if (currentStatus === "on_hold" && !canOverrideWorkOrderStatus(role)) {
    return false;
  }

  // QC column requires status override (managers/owners).
  if (columnId === "qc") {
    return canOverrideWorkOrderStatus(role);
  }

  // Remaining columns: front-office editors, or override roles.
  return canEditWorkOrder(role) || canOverrideWorkOrderStatus(role);
}

export function canDragWorkOrderOnBoard(
  role: UserRole,
  status: WorkOrderStatus,
  isForeignLocation: boolean
): boolean {
  if (isForeignLocation) return false;
  if (!isBoardDraggableStatus(status)) return false;
  if (status === "on_hold") return canOverrideWorkOrderStatus(role);
  return canEditWorkOrder(role) || canOverrideWorkOrderStatus(role);
}
