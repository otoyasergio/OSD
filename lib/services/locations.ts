import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/database/supabase-server";
import { addAuditLog } from "@/lib/audit/addAuditLog";
import { canManageLocations } from "@/lib/permissions";
import { locationSchema } from "@/lib/validation/schemas";

export type LocationRecord = {
  location_id: string;
  name: string;
  code: string;
  status: "active" | "inactive";
  created_at: string;
  updated_at: string;
  user_count: number;
  assigned_user_ids: string[];
};

export type LocationUserOption = {
  user_id: string;
  first_name: string;
  last_name: string;
  email: string;
  role: string;
  status: string;
};

async function requireOwner() {
  const user = await requireUser();
  if (!canManageLocations(user.role)) throw new Error("FORBIDDEN");
  return user;
}

export async function listLocations(): Promise<LocationRecord[]> {
  await requireOwner();
  const supabase = await createClient();

  const { data: locations, error } = await supabase
    .from("location")
    .select("location_id, name, code, status, created_at, updated_at")
    .order("name");
  if (error) throw error;

  const { data: memberships, error: membershipError } = await supabase
    .from("user_location")
    .select("user_id, location_id");
  if (membershipError) throw membershipError;

  const byLocation = new Map<string, string[]>();
  for (const row of memberships ?? []) {
    const list = byLocation.get(row.location_id) ?? [];
    list.push(row.user_id);
    byLocation.set(row.location_id, list);
  }

  return ((locations ?? []) as Array<Omit<LocationRecord, "user_count" | "assigned_user_ids">>).map(
    (loc) => {
      const assigned = byLocation.get(loc.location_id) ?? [];
      return {
        ...loc,
        status: loc.status as "active" | "inactive",
        user_count: assigned.length,
        assigned_user_ids: assigned,
      };
    }
  );
}

export async function listUsersForLocationAssignment(): Promise<
  LocationUserOption[]
> {
  await requireOwner();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("app_user")
    .select("user_id, first_name, last_name, email, role, status")
    .order("last_name")
    .order("first_name");
  if (error) throw error;
  return (data ?? []) as LocationUserOption[];
}

export async function createLocation(input: {
  name: string;
  code: string;
  status?: "active" | "inactive";
}): Promise<{ location_id: string }> {
  const user = await requireOwner();
  const parsed = locationSchema.parse({
    ...input,
    status: input.status ?? "active",
  });
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("location")
    .insert({
      name: parsed.name.trim(),
      code: parsed.code.trim().toUpperCase(),
      status: parsed.status,
    })
    .select("location_id, name, code, status")
    .single();
  if (error) throw error;

  const { error: seqError } = await supabase.from("work_order_sequence").insert({
    location_id: data.location_id,
    next_number: 1001,
  });
  if (seqError) throw seqError;

  await addAuditLog(supabase, {
    actor_user_id: user.user_id,
    location_id: data.location_id,
    action: "location_created",
    entity_type: "location",
    entity_id: data.location_id,
    description: `Created location ${data.name} (${data.code})`,
    new_value: data,
  });

  return { location_id: data.location_id };
}

export async function updateLocation(
  locationId: string,
  input: { name: string; code: string; status: "active" | "inactive" }
): Promise<void> {
  const user = await requireOwner();
  const parsed = locationSchema.parse(input);
  const supabase = await createClient();

  const { data: existing, error: loadError } = await supabase
    .from("location")
    .select("location_id, name, code, status")
    .eq("location_id", locationId)
    .maybeSingle();
  if (loadError) throw loadError;
  if (!existing) throw new Error("LOCATION_NOT_FOUND");

  const { data, error } = await supabase
    .from("location")
    .update({
      name: parsed.name.trim(),
      code: parsed.code.trim().toUpperCase(),
      status: parsed.status,
      updated_at: new Date().toISOString(),
    })
    .eq("location_id", locationId)
    .select("location_id, name, code, status")
    .single();
  if (error) throw error;

  await addAuditLog(supabase, {
    actor_user_id: user.user_id,
    location_id: locationId,
    action: "location_updated",
    entity_type: "location",
    entity_id: locationId,
    description: `Updated location ${data.name}`,
    old_value: existing,
    new_value: data,
  });
}

export async function setLocationUsers(
  locationId: string,
  userIds: string[]
): Promise<void> {
  const user = await requireOwner();
  const supabase = await createClient();

  const { data: location, error: locError } = await supabase
    .from("location")
    .select("location_id, name")
    .eq("location_id", locationId)
    .maybeSingle();
  if (locError) throw locError;
  if (!location) throw new Error("LOCATION_NOT_FOUND");

  const uniqueIds = [...new Set(userIds.filter(Boolean))];

  const { data: existing, error: existingError } = await supabase
    .from("user_location")
    .select("user_id")
    .eq("location_id", locationId);
  if (existingError) throw existingError;

  const previousIds = (existing ?? []).map(
    (row: { user_id: string }) => row.user_id
  );

  const { error: deleteError } = await supabase
    .from("user_location")
    .delete()
    .eq("location_id", locationId);
  if (deleteError) throw deleteError;

  if (uniqueIds.length > 0) {
    const { error: insertError } = await supabase.from("user_location").insert(
      uniqueIds.map((user_id) => ({
        user_id,
        location_id: locationId,
      }))
    );
    if (insertError) throw insertError;
  }

  await addAuditLog(supabase, {
    actor_user_id: user.user_id,
    location_id: locationId,
    action: "location_users_updated",
    entity_type: "location",
    entity_id: locationId,
    description: `Updated staff assignments for ${location.name}`,
    old_value: { user_ids: previousIds },
    new_value: { user_ids: uniqueIds },
  });
}
