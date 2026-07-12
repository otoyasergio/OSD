import type { DbClient } from "@/lib/database/types";

type Args = {
  actor_user_id: string | null;
  location_id?: string | null;
  action: string;
  entity_type: string;
  entity_id?: string | null;
  description: string;
  old_value?: unknown;
  new_value?: unknown;
};

export async function addAuditLog(supabase: DbClient, args: Args) {
  const { error } = await supabase.from("audit_log").insert({
    actor_user_id: args.actor_user_id,
    location_id: args.location_id ?? null,
    action: args.action,
    entity_type: args.entity_type,
    entity_id: args.entity_id ?? null,
    description: args.description,
    old_value: args.old_value ?? null,
    new_value: args.new_value ?? null,
  });
  if (error) throw error;
}
