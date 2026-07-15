import { addAuditLog } from "@/lib/audit/addAuditLog";
import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/database/supabase-server";
import { shopDateKey } from "@/lib/datetime/format";
import { canManageShopClosures } from "@/lib/permissions";
import { shopClosureSchema } from "@/lib/validation/schemas";

export type ShopClosure = {
  location_id: string;
  closure_date: string;
  reason: string | null;
  created_at: string;
};

export async function listUpcomingShopClosures(): Promise<ShopClosure[]> {
  const user = await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("shop_closure")
    .select("location_id, closure_date, reason, created_at")
    .eq("location_id", user.active_location_id!)
    .gte("closure_date", shopDateKey(new Date()))
    .order("closure_date", { ascending: true });
  if (error) throw error;
  return (data ?? []) as ShopClosure[];
}

export async function listUpcomingShopClosureDates(): Promise<string[]> {
  const closures = await listUpcomingShopClosures();
  return closures.map((closure) => closure.closure_date);
}

async function requireClosureManager() {
  const user = await requireUser();
  if (!canManageShopClosures(user.role)) throw new Error("FORBIDDEN");
  return user;
}

export async function addShopClosure(input: {
  closure_date: string;
  reason?: string | null;
}): Promise<void> {
  const user = await requireClosureManager();
  const parsed = shopClosureSchema.parse(input);
  if (parsed.closure_date < shopDateKey(new Date())) {
    throw new Error("SHOP_CLOSURE_IN_PAST");
  }

  const supabase = await createClient();
  const row = {
    location_id: user.active_location_id!,
    closure_date: parsed.closure_date,
    reason: parsed.reason,
  };
  const { error } = await supabase.from("shop_closure").insert(row);
  if (error?.code === "23505") throw new Error("SHOP_CLOSURE_EXISTS");
  if (error) throw error;

  await addAuditLog(supabase, {
    actor_user_id: user.user_id,
    location_id: user.active_location_id,
    action: "shop_closure_added",
    entity_type: "shop_closure",
    description: `Marked ${parsed.closure_date} as closed`,
    new_value: row,
  });
}

export async function deleteShopClosure(closureDate: string): Promise<void> {
  const user = await requireClosureManager();
  const parsed = shopClosureSchema.pick({ closure_date: true }).parse({
    closure_date: closureDate,
  });
  const supabase = await createClient();

  const { data: existing, error: loadError } = await supabase
    .from("shop_closure")
    .select("location_id, closure_date, reason, created_at")
    .eq("location_id", user.active_location_id!)
    .eq("closure_date", parsed.closure_date)
    .maybeSingle();
  if (loadError) throw loadError;
  if (!existing) throw new Error("SHOP_CLOSURE_NOT_FOUND");

  const { error } = await supabase
    .from("shop_closure")
    .delete()
    .eq("location_id", user.active_location_id!)
    .eq("closure_date", parsed.closure_date);
  if (error) throw error;

  await addAuditLog(supabase, {
    actor_user_id: user.user_id,
    location_id: user.active_location_id,
    action: "shop_closure_removed",
    entity_type: "shop_closure",
    description: `Removed closure for ${parsed.closure_date}`,
    old_value: existing,
  });
}
