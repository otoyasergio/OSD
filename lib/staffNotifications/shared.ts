import { isTerminalWorkOrderStatus } from "@/lib/technician/floorActionModel";

type NestedWorkOrder = {
  work_order_id: string;
  work_order_number: string;
  status?: string | null;
  motorcycle:
    | {
        year: number;
        make: string;
        model: string;
      }
    | Array<{
        year: number;
        make: string;
        model: string;
      }>
    | null;
};

export type StaffNotificationKind = "work_order_assigned" | "ready_for_pickup";

export type StaffNotificationRow = {
  staff_notification_id: string;
  kind: StaffNotificationKind;
  work_order_id: string;
  created_at: string;
  actor:
    | { first_name: string; last_name: string }
    | Array<{ first_name: string; last_name: string }>
    | null;
  work_order: NestedWorkOrder | NestedWorkOrder[] | null;
};

export type StaffAssignmentNotification = {
  notification_id: string;
  kind: StaffNotificationKind;
  work_order_id: string;
  work_order_number: string;
  motorcycle_label: string;
  actor_name: string | null;
  created_at: string;
};

function unwrapOne<T>(value: T | T[] | null): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

export function motorcycleNotificationLabel(
  motorcycle: { year: number; make: string; model: string } | null
): string {
  if (!motorcycle) return "Motorcycle";
  return [motorcycle.year, motorcycle.make, motorcycle.model].filter(Boolean).join(" ");
}

export function formatNotificationAge(
  createdAt: string,
  nowMs: number = Date.now()
): string {
  const createdMs = Date.parse(createdAt);
  if (!Number.isFinite(createdMs)) return "Just now";

  const seconds = Math.max(0, Math.floor((nowMs - createdMs) / 1000));
  if (seconds < 60) return "Just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function staffNotificationTitle(kind: StaffNotificationKind): string {
  if (kind === "ready_for_pickup") return "Ready for pickup";
  return "New motorcycle assignment";
}

/**
 * Pure mapper — drops rows whose work order is gone or already
 * completed/cancelled, so stale alerts never ping staff.
 */
export function mapUnreadStaffNotifications(
  rows: readonly StaffNotificationRow[]
): StaffAssignmentNotification[] {
  return rows.flatMap((row) => {
    const workOrder = unwrapOne(row.work_order);
    if (!workOrder) return [];
    if (isTerminalWorkOrderStatus(workOrder.status ?? null)) return [];
    const motorcycle = unwrapOne(workOrder.motorcycle);
    const actor = unwrapOne(row.actor);

    return [
      {
        notification_id: row.staff_notification_id,
        kind: row.kind,
        work_order_id: row.work_order_id,
        work_order_number: workOrder.work_order_number,
        motorcycle_label: motorcycleNotificationLabel(motorcycle),
        actor_name: actor ? `${actor.first_name} ${actor.last_name}`.trim() : null,
        created_at: row.created_at,
      },
    ];
  });
}
