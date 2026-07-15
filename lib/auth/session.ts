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
      "user_id, auth_user_id, first_name, last_name, email, profile_photo_path, role, status"
    )
    .eq("auth_user_id", authUserId)
    .maybeSingle();

  if (!user || user.status !== "active") return null;

  const { data: locs } = await supabase
    .from("user_location")
    .select("location_id")
    .eq("user_id", user.user_id);

  const location_ids = (locs ?? []).map((l) => l.location_id);
  const cookieStore = await cookies();
  const cookieLoc = cookieStore.get(ACTIVE_LOCATION_COOKIE)?.value ?? null;
  const active_location_id =
    cookieLoc && location_ids.includes(cookieLoc) ? cookieLoc : (location_ids[0] ?? null);

  return {
    ...user,
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
