import type { DbClient } from "@/lib/database/types";

type Args = {
  work_order_id: string;
  user_id: string | null;
  event_type: string;
  entity_type: string;
  entity_id?: string | null;
  description: string;
  old_value?: unknown;
  new_value?: unknown;
};

export async function addTimelineEvent(supabase: DbClient, args: Args) {
  const { error } = await supabase.from("timeline_event").insert({
    work_order_id: args.work_order_id,
    user_id: args.user_id,
    event_type: args.event_type,
    entity_type: args.entity_type,
    entity_id: args.entity_id ?? null,
    description: args.description,
    old_value: args.old_value ?? null,
    new_value: args.new_value ?? null,
  });
  if (error) throw error;
}
