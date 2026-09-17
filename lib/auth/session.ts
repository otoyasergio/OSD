import { cache } from "react";
import { createClient } from "@/lib/database/supabase-server";
import { cookies } from "next/headers";
import { ACTIVE_LOCATION_COOKIE } from "@/lib/auth/location-cookie";
import type { UserRole, UserStatus } from "@/lib/database/types";
import { getSupabasePublicConfig } from "@/lib/database/config";

export type AppUser = {
  user_id: string;
  auth_user_id: string;
  first_name: string;
  last_name: string;
  email: string;
  profile_photo_path: string | null;
  role: UserRole;
  status: UserStatus;
  location_ids: string[];
  active_location_id: string | null;
};

type LocationStatusEmbed = { status: string };
export type UserLocationEmbed = {
  location_id: string;
  location: LocationStatusEmbed | LocationStatusEmbed[] | null;
};

function unwrapOne<T>(value: T | T[] | null | undefined): T | null {
  if (value == null) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

export function activeLocationIdsFromMemberships(
  rows: UserLocationEmbed[] | null | undefined
): string[] {
  const ids: string[] = [];
  for (const row of rows ?? []) {
    if (unwrapOne(row.location)?.status === "active") ids.push(row.location_id);
  }
  return ids;
}

/** Deduped per React request — layout, page, and services share one Auth+DB lookup. */
export const getCurrentAppUser = cache(async (): Promise<AppUser | null> => {
  if (!getSupabasePublicConfig()) return null;

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const authUserId = auth?.claims.sub;
  if (!authUserId) return null;

  const { data: user } = await supabase
    .from("app_user")
    .select(
      `
      user_id,
      auth_user_id,
      first_name,
      last_name,
      email,
      profile_photo_path,
      role,
      status,
      user_location (
        location_id,
        location ( status )
      )
    `
    )
    .eq("auth_user_id", authUserId)
    .maybeSingle();

  if (!user || user.status !== "active") return null;

  const location_ids = activeLocationIdsFromMemberships(
    user.user_location as UserLocationEmbed[] | null
  );
  const cookieStore = await cookies();
  const cookieLoc = cookieStore.get(ACTIVE_LOCATION_COOKIE)?.value ?? null;
  const active_location_id =
    cookieLoc && location_ids.includes(cookieLoc) ? cookieLoc : (location_ids[0] ?? null);

  return {
    user_id: user.user_id,
    auth_user_id: user.auth_user_id,
    first_name: user.first_name,
    last_name: user.last_name,
    email: user.email,
    profile_photo_path: user.profile_photo_path,
    role: user.role as UserRole,
    status: user.status as UserStatus,
    location_ids,
    active_location_id,
  };
});

export async function requireUser(): Promise<AppUser> {
  const user = await getCurrentAppUser();
  if (!user) throw new Error("UNAUTHORIZED");
  if (!user.active_location_id) throw new Error("NO_LOCATION");
  return user;
}
