type NoteEvent = "INSERT" | "UPDATE";

type RealtimeChannelLike = {
  on(
    kind: "postgres_changes",
    filter: {
      event: NoteEvent;
      schema: "public";
      table: "technician_note";
      filter: string;
    },
    callback: () => void
  ): RealtimeChannelLike;
};

/**
 * Notes are append-only. INSERT and UPDATE carry work_order_id, so an open
 * floor tablet and an open work order can refresh without a manual reload.
 * An empty id list subscribes to nothing — never the whole shop.
 */
export function registerTechnicianNoteRealtime<T extends RealtimeChannelLike>(
  channel: T,
  workOrderIds: string[],
  callback: () => void
): T {
  if (workOrderIds.length === 0) return channel;
  const filter =
    workOrderIds.length === 1
      ? `work_order_id=eq.${workOrderIds[0]}`
      : `work_order_id=in.(${workOrderIds.join(",")})`;
  channel
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "technician_note",
        filter,
      },
      callback
    )
    .on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "technician_note",
        filter,
      },
      callback
    );
  return channel;
}
