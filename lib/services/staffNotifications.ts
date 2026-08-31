import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/database/supabase-server";
import { canReceiveStaffNotifications } from "@/lib/permissions";
import {
  mapUnreadStaffNotifications,
  type StaffAssignmentNotification,
  type StaffNotificationRow,
} from "@/lib/staffNotifications/shared";

export type {
  StaffAssignmentNotification,
  StaffNotificationKind,
  StaffNotificationRow,
} from "@/lib/staffNotifications/shared";

export {
  formatNotificationAge,
  mapUnreadStaffNotifications,
  motorcycleNotificationLabel,
  staffNotificationTitle,
} from "@/lib/staffNotifications/shared";

export async function listUnreadStaffNotifications(
  limit = 8
): Promise<StaffAssignmentNotification[]> {
  const user = await requireUser();
  if (!canReceiveStaffNotifications(user.role)) return [];

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
        status,
        motorcycle:motorcycle_id ( year, make, model )
      )
    `
    )
    .eq("recipient_user_id", user.user_id)
    .is("read_at", null)
    .order("created_at", { ascending: false })
    .limit(safeLimit);

  if (error) throw error;

  return mapUnreadStaffNotifications((data ?? []) as unknown as StaffNotificationRow[]);
}

export async function markStaffNotificationRead(notificationId: string): Promise<void> {
  const user = await requireUser();
  if (!canReceiveStaffNotifications(user.role)) throw new Error("FORBIDDEN");

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
  if (!canReceiveStaffNotifications(user.role)) throw new Error("FORBIDDEN");

  const supabase = await createClient();
  const { error } = await supabase
    .from("staff_notification")
    .update({ read_at: new Date().toISOString() })
    .eq("recipient_user_id", user.user_id)
    .is("read_at", null);

  if (error) throw error;
}
