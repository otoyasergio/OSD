"use server";

import {
  listUnreadStaffNotifications,
  markAllStaffNotificationsRead,
  markStaffNotificationRead,
  type StaffAssignmentNotification,
} from "@/lib/services/staffNotifications";

export async function refreshStaffNotificationsAction(): Promise<
  StaffAssignmentNotification[]
> {
  return listUnreadStaffNotifications();
}

export async function markStaffNotificationReadAction(
  notificationId: string
): Promise<void> {
  await markStaffNotificationRead(notificationId);
}

export async function markAllStaffNotificationsReadAction(): Promise<void> {
  await markAllStaffNotificationsRead();
}
