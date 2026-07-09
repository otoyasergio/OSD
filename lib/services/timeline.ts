import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/database/supabase-server";

export type TimelineEvent = {
  timeline_event_id: string;
  work_order_id: string;
  user_id: string | null;
  event_type: string;
  entity_type: string;
  entity_id: string | null;
  description: string;
  old_value: unknown;
  new_value: unknown;
  created_at: string;
  user?: {
    user_id: string;
    first_name: string;
    last_name: string;
  } | null;
};

export async function listTimelineEvents(
  workOrderId: string,
  options: { ascending?: boolean } = {}
): Promise<TimelineEvent[]> {
  await requireUser();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("timeline_event")
    .select(
      `
      timeline_event_id,
      work_order_id,
      user_id,
      event_type,
      entity_type,
      entity_id,
      description,
      old_value,
      new_value,
      created_at,
      user:user_id (
        user_id,
        first_name,
        last_name
      )
    `
    )
    .eq("work_order_id", workOrderId)
    .order("created_at", { ascending: options.ascending ?? false });

  if (error) throw error;
  return (data ?? []) as unknown as TimelineEvent[];
}
