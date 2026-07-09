import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/database/supabase-server";
import type { UserRole, UserStatus } from "@/lib/database/types";
import { addAuditLog } from "@/lib/audit/addAuditLog";
import { canManageUsers } from "@/lib/permissions";
import {
  appUserLinkSchema,
  appUserUpdateSchema,
} from "@/lib/validation/schemas";

export type ManagedUser = {
  user_id: string;
  auth_user_id: string | null;
  first_name: string;
  last_name: string;
  email: string;
  phone: string | null;
  role: UserRole;
  status: UserStatus;
  created_at: string;
  updated_at: string;
  location_ids: string[];
  locations: Array<{ location_id: string; name: string; code: string }>;
};

export type LocationOption = {
  location_id: string;
  name: string;
  code: string;
  status: string;
};

async function requireOwner() {
  const user = await requireUser();
  if (!canManageUsers(user.role)) throw new Error("FORBIDDEN");
  return user;
}

export async function listManagedUsers(): Promise<ManagedUser[]> {
  await requireOwner();
  const supabase = await createClient();

  const { data: users, error } = await supabase
    .from("app_user")
    .select(
      "user_id, auth_user_id, first_name, last_name, email, phone, role, status, created_at, updated_at"
    )
    .order("last_name")
    .order("first_name");
  if (error) throw error;

  const { data: memberships, error: membershipError } = await supabase
    .from("user_location")
    .select(
      `
      user_id,
      location:location_id (
        location_id,
        name,
        code
      )
    `
    );
  if (membershipError) throw membershipError;

  const byUser = new Map<
    string,
    Array<{ location_id: string; name: string; code: string }>
  >();

  for (const row of (memberships ?? []) as Array<{
    user_id: string;
    location:
      | { location_id: string; name: string; code: string }
      | Array<{ location_id: string; name: string; code: string }>
      | null;
  }>) {
    const loc = Array.isArray(row.location) ? row.location[0] : row.location;
    if (!loc) continue;
    const list = byUser.get(row.user_id) ?? [];
    list.push(loc);
    byUser.set(row.user_id, list);
  }

  return ((users ?? []) as Array<Omit<ManagedUser, "location_ids" | "locations">>).map(
    (person) => {
      const locations = byUser.get(person.user_id) ?? [];
      return {
        ...person,
        role: person.role as UserRole,
        status: person.status as UserStatus,
        location_ids: locations.map((loc) => loc.location_id),
        locations,
      };
    }
  );
}

export async function listLocationOptions(): Promise<LocationOption[]> {
  await requireOwner();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("location")
    .select("location_id, name, code, status")
    .order("name");
  if (error) throw error;
  return (data ?? []) as LocationOption[];
}

async function replaceUserLocations(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  locationIds: string[]
) {
  const unique = [...new Set(locationIds)];
  const { error: deleteError } = await supabase
    .from("user_location")
    .delete()
    .eq("user_id", userId);
  if (deleteError) throw deleteError;

  if (unique.length === 0) return;

  const { error: insertError } = await supabase.from("user_location").insert(
    unique.map((location_id) => ({
      user_id: userId,
      location_id,
    }))
  );
  if (insertError) throw insertError;
}

/**
 * V1: create the Auth user in Supabase Dashboard first, then link here with
 * the Auth UUID (`auth.users.id`), role, and locations.
 */
export async function linkAppUser(input: {
  auth_user_id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone?: string | null;
  role: UserRole;
  location_ids: string[];
}): Promise<{ user_id: string }> {
  const actor = await requireOwner();
  const parsed = appUserLinkSchema.parse({
    ...input,
    phone: input.phone?.trim() || null,
  });
  const supabase = await createClient();

  const { data: existingAuth, error: existingAuthError } = await supabase
    .from("app_user")
    .select("user_id")
    .eq("auth_user_id", parsed.auth_user_id)
    .maybeSingle();
  if (existingAuthError) throw existingAuthError;
  if (existingAuth) throw new Error("USER_ALREADY_LINKED");

  const { data, error } = await supabase
    .from("app_user")
    .insert({
      auth_user_id: parsed.auth_user_id,
      first_name: parsed.first_name.trim(),
      last_name: parsed.last_name.trim(),
      email: parsed.email.trim().toLowerCase(),
      phone: parsed.phone?.trim() || null,
      role: parsed.role,
      status: "active",
    })
    .select(
      "user_id, auth_user_id, first_name, last_name, email, phone, role, status"
    )
    .single();
  if (error) throw error;

  await replaceUserLocations(supabase, data.user_id, parsed.location_ids);

  await addAuditLog(supabase, {
    actor_user_id: actor.user_id,
    location_id: actor.active_location_id,
    action: "user_linked",
    entity_type: "app_user",
    entity_id: data.user_id,
    description: `Linked app user ${data.email} (${data.role})`,
    new_value: {
      ...data,
      location_ids: parsed.location_ids,
    },
  });

  return { user_id: data.user_id };
}

export async function updateAppUser(
  userId: string,
  input: {
    first_name: string;
    last_name: string;
    email: string;
    phone?: string | null;
    role: UserRole;
    status: UserStatus;
    location_ids: string[];
  }
): Promise<void> {
  const actor = await requireOwner();
  const parsed = appUserUpdateSchema.parse({
    ...input,
    phone: input.phone?.trim() || null,
  });
  const supabase = await createClient();

  const { data: existing, error: loadError } = await supabase
    .from("app_user")
    .select(
      "user_id, auth_user_id, first_name, last_name, email, phone, role, status"
    )
    .eq("user_id", userId)
    .maybeSingle();
  if (loadError) throw loadError;
  if (!existing) throw new Error("USER_NOT_FOUND");

  const { data: previousLocations, error: prevLocError } = await supabase
    .from("user_location")
    .select("location_id")
    .eq("user_id", userId);
  if (prevLocError) throw prevLocError;

  const { data, error } = await supabase
    .from("app_user")
    .update({
      first_name: parsed.first_name.trim(),
      last_name: parsed.last_name.trim(),
      email: parsed.email.trim().toLowerCase(),
      phone: parsed.phone?.trim() || null,
      role: parsed.role,
      status: parsed.status,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId)
    .select(
      "user_id, auth_user_id, first_name, last_name, email, phone, role, status"
    )
    .single();
  if (error) throw error;

  await replaceUserLocations(supabase, userId, parsed.location_ids);

  await addAuditLog(supabase, {
    actor_user_id: actor.user_id,
    location_id: actor.active_location_id,
    action: "user_updated",
    entity_type: "app_user",
    entity_id: userId,
    description: `Updated app user ${data.email}`,
    old_value: {
      ...existing,
      location_ids: (previousLocations ?? []).map(
        (row: { location_id: string }) => row.location_id
      ),
    },
    new_value: {
      ...data,
      location_ids: parsed.location_ids,
    },
  });
}

export async function setAppUserStatus(
  userId: string,
  status: UserStatus
): Promise<void> {
  const actor = await requireOwner();
  if (!["active", "inactive", "suspended"].includes(status)) {
    throw new Error("INVALID_STATUS");
  }
  const supabase = await createClient();

  const { data: existing, error: loadError } = await supabase
    .from("app_user")
    .select("user_id, email, status")
    .eq("user_id", userId)
    .maybeSingle();
  if (loadError) throw loadError;
  if (!existing) throw new Error("USER_NOT_FOUND");

  const { error } = await supabase
    .from("app_user")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("user_id", userId);
  if (error) throw error;

  await addAuditLog(supabase, {
    actor_user_id: actor.user_id,
    location_id: actor.active_location_id,
    action: "user_status_changed",
    entity_type: "app_user",
    entity_id: userId,
    description: `Changed ${existing.email} status to ${status}`,
    old_value: { status: existing.status },
    new_value: { status },
  });
}
