type NotificationEvent = "INSERT" | "UPDATE";

type RealtimeChannelLike = {
  on(
    kind: "postgres_changes",
    filter: {
      event: NotificationEvent;
      schema: "public";
      table: "staff_notification";
      filter: string;
    },
    callback: () => void
  ): RealtimeChannelLike;
};

/**
 * Subscribe only to events that Realtime can filter by recipient. DELETE
 * payloads are not filterable reliably and notifications are append/read-only
 * for staff, so focus/visibility refresh remains the deletion fallback.
 */
export function registerStaffNotificationRealtime<T extends RealtimeChannelLike>(
  channel: T,
  userId: string,
  callback: () => void
): T {
  const filter = `recipient_user_id=eq.${userId}`;
  channel
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "staff_notification",
        filter,
      },
      callback
    )
    .on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "staff_notification",
        filter,
      },
      callback
    );
  return channel;
}
