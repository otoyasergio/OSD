import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/database/supabase-server";
import { isFloorTech } from "@/lib/permissions";

type NestedWorkOrder = {
  work_order_id: string;
  work_order_number: string;
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

type NotificationRow = {
  staff_notification_id: string;
  kind: "work_order_assigned";
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
  kind: "work_order_assigned";
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

export async function listUnreadStaffNotifications(
  limit = 8
): Promise<StaffAssignmentNotification[]> {
  const user = await requireUser();
  if (!isFloorTech(user.role)) return [];

  const supabase = await createClient();
  const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 20);
  const { data, error } = await supabase
    .from("staff_notification")
    .select(
      `
      staff_notification_id,
      kind,
      work_order_id,
      created_at,
      actor:actor_user_id ( first_name, last_name ),
      work_order:work_order_id (
        work_order_id,
        work_order_number,
        motorcycle:motorcycle_id ( year, make, model )
      )
    `
    )
    .eq("recipient_user_id", user.user_id)
    .is("read_at", null)
    .order("created_at", { ascending: false })
    .limit(safeLimit);

  if (error) throw error;

  return ((data ?? []) as unknown as NotificationRow[]).flatMap((row) => {
    const workOrder = unwrapOne(row.work_order);
    if (!workOrder) return [];
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

export async function markStaffNotificationRead(notificationId: string): Promise<void> {
  const user = await requireUser();
  if (!isFloorTech(user.role)) throw new Error("FORBIDDEN");

  const supabase = await createClient();
  const { error } = await supabase
    .from("staff_notification")
    .update({ read_at: new Date().toISOString() })
    .eq("staff_notification_id", notificationId)
    .eq("recipient_user_id", user.user_id)
    .is("read_at", null);

  if (error) throw error;
}

export async function markAllStaffNotificationsRead(): Promise<void> {
  const user = await requireUser();
  if (!isFloorTech(user.role)) throw new Error("FORBIDDEN");

  const supabase = await createClient();
  const { error } = await supabase
    .from("staff_notification")
    .update({ read_at: new Date().toISOString() })
    .eq("recipient_user_id", user.user_id)
    .is("read_at", null);

  if (error) throw error;
}
