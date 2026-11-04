import { addAuditLog } from "@/lib/audit/addAuditLog";
import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/database/supabase-server";
import { canManageShopRate } from "@/lib/permissions";
import { resolveShopHourlyRate } from "@/lib/pricing/shopRate";
import { shopRateSchema } from "@/lib/validation/schemas";

export type LocationShopRate = {
  location_id: string;
  location_name: string;
  hourly_rate: number;
};

function asHourlyRate(value: unknown): number {
  return resolveShopHourlyRate(value);
}

/** Readable by any signed-in staff at the active location. */
export async function getActiveLocationShopRate(): Promise<LocationShopRate> {
  const user = await requireUser();
  if (!user.active_location_id) throw new Error("NO_LOCATION");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("location")
    .select("location_id, name, hourly_rate")
    .eq("location_id", user.active_location_id)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("LOCATION_NOT_FOUND");

  return {
    location_id: data.location_id,
    location_name: data.name,
    hourly_rate: asHourlyRate(data.hourly_rate),
  };
}

export async function getActiveLocationHourlyRate(): Promise<number> {
  const shop = await getActiveLocationShopRate();
  return shop.hourly_rate;
}

export async function updateActiveLocationShopRate(input: {
  hourly_rate: number | string;
}): Promise<LocationShopRate> {
  const user = await requireUser();
  if (!canManageShopRate(user.role)) throw new Error("FORBIDDEN");
  if (!user.active_location_id) throw new Error("NO_LOCATION");

  const parsed = shopRateSchema.parse(input);
  const supabase = await createClient();

  const { data: existing, error: loadError } = await supabase
    .from("location")
    .select("location_id, name, hourly_rate")
    .eq("location_id", user.active_location_id)
    .maybeSingle();
  if (loadError) throw loadError;
  if (!existing) throw new Error("LOCATION_NOT_FOUND");

  const { data, error } = await supabase
    .from("location")
    .update({
      hourly_rate: parsed.hourly_rate,
      updated_at: new Date().toISOString(),
    })
    .eq("location_id", user.active_location_id)
    .select("location_id, name, hourly_rate")
    .single();
  if (error) throw error;

  await addAuditLog(supabase, {
    actor_user_id: user.user_id,
    location_id: user.active_location_id,
    action: "shop_rate_updated",
    entity_type: "location",
    entity_id: data.location_id,
    description: `Set shop rate to $${parsed.hourly_rate}/h for ${data.name}`,
    old_value: { hourly_rate: asHourlyRate(existing.hourly_rate) },
    new_value: { hourly_rate: parsed.hourly_rate },
  });

  return {
    location_id: data.location_id,
    location_name: data.name,
    hourly_rate: asHourlyRate(data.hourly_rate),
  };
}
