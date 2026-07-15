import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/database/supabase-server";
import type { UserRole } from "@/lib/database/types";
import { canUseMessenger } from "@/lib/permissions";
import { sortDirectory } from "@/lib/messenger/directorySort";
import { createProfilePhotoSignedUrls } from "@/lib/profilePhotos/storage";

export type DirectoryStaff = {
  user_id: string;
  first_name: string;
  last_name: string;
  role: UserRole;
  profile_photo_url: string | null;
  location_ids: string[];
};

export async function listDirectory(search?: string): Promise<DirectoryStaff[]> {
  const user = await requireUser();
  if (!canUseMessenger(user.role)) throw new Error("FORBIDDEN");
  const supabase = await createClient();

  let query = supabase
    .from("app_user")
    .select(
      "user_id, first_name, last_name, role, profile_photo_path, user_location(location_id)"
    )
    .eq("status", "active")
    .neq("user_id", user.user_id);

  if (search?.trim()) {
    const term = search.trim().replace(/[%_,]/g, "");
    if (term) {
      query = query.or(`first_name.ilike.%${term}%,last_name.ilike.%${term}%`);
    }
  }

  const { data, error } = await query;
  if (error) throw error;

  const signedUrls = await createProfilePhotoSignedUrls(
    supabase,
    (data ?? []).map((row) => row.profile_photo_path)
  );

  const staff = (data ?? []).map((row) => {
    const locations = Array.isArray(row.user_location)
      ? row.user_location
      : row.user_location
        ? [row.user_location]
        : [];
    return {
      user_id: row.user_id as string,
      first_name: row.first_name as string,
      last_name: row.last_name as string,
      role: row.role as UserRole,
      profile_photo_url: row.profile_photo_path
        ? (signedUrls.get(row.profile_photo_path) ?? null)
        : null,
      location_ids: locations.map((l: { location_id: string }) => l.location_id),
    };
  });

  return sortDirectory(staff, user.active_location_id);
}

export function splitDirectorySections(
  staff: DirectoryStaff[],
  activeLocationId: string | null
): { atLocation: DirectoryStaff[]; allCompany: DirectoryStaff[] } {
  if (!activeLocationId) {
    return { atLocation: [], allCompany: staff };
  }
  const atLocation = staff.filter((s) => s.location_ids.includes(activeLocationId));
  const atIds = new Set(atLocation.map((s) => s.user_id));
  const allCompany = staff.filter((s) => !atIds.has(s.user_id));
  return { atLocation, allCompany };
}
