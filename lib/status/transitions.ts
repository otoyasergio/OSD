import type { UserRole, WorkOrderStatus } from "@/lib/database/types";
import {
  canCompleteWorkOrder,
  canEditWorkOrder,
  canOverrideWorkOrderStatus,
  canParkAnyBikeInStorage,
  canRearrangeControlCenter,
} from "@/lib/permissions";
import type { GALLERY_BOARD_COLUMNS, SHOP_BOARD_COLUMNS } from "@/lib/status/pipeline";

export type ShopBoardColumnId =
  | (typeof SHOP_BOARD_COLUMNS)[number]["id"]
  | (typeof GALLERY_BOARD_COLUMNS)[number]["id"]
  | "complete";

/** Primary status applied when a card is dropped into a board column. */
const COLUMN_TARGET_STATUS: Record<ShopBoardColumnId, WorkOrderStatus | null> = {
  intake: "open",
  inspection: "inspection_in_progress",
  approval: "waiting_for_customer_approval",
  parts: "waiting_for_parts",
  ready: "ready_for_technician",
  in_progress: "in_progress",
  qc: "quality_check",
  safety: "safety_check",
  pickup: "ready_for_pickup",
  storage: "in_storage",
  complete: "completed",
  on_hold: null,
  gallery_intake: "open",
  gallery_in_bay: "in_progress",
  gallery_qc: "quality_check",
  gallery_safety: "safety_check",
  gallery_ready: "ready_for_pickup",
  gallery_storage: "in_storage",
};

export function getTargetStatusForColumn(columnId: string): WorkOrderStatus | null {
  if (!(columnId in COLUMN_TARGET_STATUS)) return null;
  return COLUMN_TARGET_STATUS[columnId as ShopBoardColumnId];
}

/** Shop-floor Ready and Control Center Ready both mean the bike can leave. */
export function isPickupBoardColumn(columnId: string): boolean {
  return columnId === "pickup" || columnId === "gallery_ready";
}

/** Shop-floor Storage and gallery Storage — finished bike stays in the building. */
export function isStorageBoardColumn(columnId: string): boolean {
  return columnId === "storage" || columnId === "gallery_storage";
}

export function isQcBoardColumn(columnId: string): boolean {
  return columnId === "qc" || columnId === "gallery_qc";
}

export function boardColumnIdForStatus(
  status: WorkOrderStatus,
  columns: readonly { id: string; statuses: readonly WorkOrderStatus[] }[]
): string | null {
  for (const column of columns) {
    if (column.statuses.includes(status)) return column.id;
  }
  return null;
}

/**
 * Resolve a dnd-kit `over.id` to a board column.
 * Dropping onto another card uses that card's column.
 */
export function resolveShopBoardDropColumnId(input: {
  overId: string;
  columnIds: ReadonlySet<string>;
  columnIdForWorkOrder: (workOrderId: string) => string | null;
}): string | null {
  if (input.columnIds.has(input.overId)) return input.overId;
  return input.columnIdForWorkOrder(input.overId);
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

  // Storage is a parking spot. Advisors and admins may drop any active bike
  // there, including one that is on hold.
  if (isStorageBoardColumn(columnId) && canParkAnyBikeInStorage(role)) {
    return true;
  }

  // on_hold cards: only managers/owners can move them off hold via board
  // (resume-style). Dropping *into* on_hold is rejected above (null target).
  if (currentStatus === "on_hold" && !canOverrideWorkOrderStatus(role)) {
    return false;
  }

  // QC / safety columns require status override (managers/owners).
  if (
    columnId === "qc" ||
    columnId === "gallery_qc" ||
    columnId === "safety" ||
    columnId === "gallery_safety"
  ) {
    return canOverrideWorkOrderStatus(role);
  }

  // Control Center complete box — front office who can release a bike.
  if (columnId === "complete") {
    return canCompleteWorkOrder(role);
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
  if (status === "on_hold") {
    return canOverrideWorkOrderStatus(role) || canParkAnyBikeInStorage(role);
  }
  if (role === "admin") return true;
  return canEditWorkOrder(role) || canOverrideWorkOrderStatus(role);
}

/**
 * Shop Board card drag check. Owner and admin can also drag a completed card
 * back out of Complete if a mistake was made.
 */
export function canDragShopBoardCard(
  role: UserRole,
  status: WorkOrderStatus,
  isForeignLocation: boolean
): boolean {
  if (isForeignLocation) return false;
  if (status === "cancelled") return false;
  if (canRearrangeControlCenter(role)) return true;
  return canDragWorkOrderOnBoard(role, status, isForeignLocation);
}

/**
 * Shop Board column drop check. Owner and admin can move a card forward or
 * backward into any real column, matching Control Center.
 */
export function allowsShopBoardDrop(
  role: UserRole,
  columnId: string,
  currentStatus: WorkOrderStatus
): boolean {
  if (currentStatus === "cancelled") return false;
  const target = getTargetStatusForColumn(columnId);
  if (target === null) return false;
  if (target === currentStatus) return false;
  if (canRearrangeControlCenter(role)) return true;
  return canDropInColumn(role, columnId, currentStatus);
}

export type ShopBoardKeyRow = {
  work_order_id: string;
  work_order_number: string;
  status: WorkOrderStatus;
  flags: readonly string[];
  primary_photo_url?: string | null;
  primary_technician?: {
    first_name: string;
    last_name: string;
  } | null;
  motorcycle?: {
    year: number;
    make: string;
    model: string;
    customer?: {
      first_name: string;
      last_name: string;
    } | null;
  } | null;
};

/**
 * Fingerprint of the rows rendered on ShopBoard so changes to flags, photos,
 * technician, customer, or status immediately update the client state.
 */
export function buildShopBoardRowsKey(rows: readonly ShopBoardKeyRow[]): string {
  return rows
    .map((row) => {
      const tech = row.primary_technician
        ? `${row.primary_technician.first_name} ${row.primary_technician.last_name}`
        : "";
      const bike = row.motorcycle
        ? `${row.motorcycle.year} ${row.motorcycle.make} ${row.motorcycle.model}`
        : "";
      const customer = row.motorcycle?.customer
        ? `${row.motorcycle.customer.first_name} ${row.motorcycle.customer.last_name}`
        : "";
      return [
        row.work_order_id,
        row.work_order_number,
        row.status,
        row.flags.join(","),
        row.primary_photo_url ?? "",
        tech,
        bike,
        customer,
      ].join(":");
    })
    .join("|");
}

/**
 * Keep in-flight ShopBoard drops in their target column until the server
 * snapshot reflects the new status.
 */
export function overlayShopBoardPendingMoves<
  TRow extends { work_order_id: string; status: WorkOrderStatus },
>(
  rows: readonly TRow[],
  pendingMoves: Readonly<Record<string, WorkOrderStatus>>
): {
  rows: TRow[];
  remainingPending: Record<string, WorkOrderStatus>;
} {
  const remainingPending: Record<string, WorkOrderStatus> = {};
  const nextRows = rows.map((row) => {
    const targetStatus = pendingMoves[row.work_order_id];
    if (!targetStatus) return row;
    if (row.status === targetStatus) return row;
    remainingPending[row.work_order_id] = targetStatus;
    return { ...row, status: targetStatus };
  });
  return { rows: nextRows, remainingPending };
}
