"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { ACTIVE_LOCATION_COOKIE } from "@/lib/auth/location-cookie";
import {
  ROLE_PREVIEW_ROLE_COOKIE,
  ROLE_PREVIEW_TECHNICIAN_COOKIE,
} from "@/lib/auth/role-preview-shared";
import { getCurrentAppUser } from "@/lib/auth/session";
import { addAuditLog } from "@/lib/audit/addAuditLog";
import { createClient } from "@/lib/database/supabase-server";

export async function setActiveLocation(locationId: string) {
  const user = await getCurrentAppUser();
  if (!user) throw new Error("UNAUTHORIZED");
  if (!user.location_ids.includes(locationId)) throw new Error("FORBIDDEN");

  const previousLocationId = user.active_location_id;
  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_LOCATION_COOKIE, locationId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });

  // A mirrored technician belongs to the previous location — drop the
  // technician preview so the switch can't carry a stale subject across.
  if (cookieStore.get(ROLE_PREVIEW_ROLE_COOKIE)?.value === "technician") {
    cookieStore.delete(ROLE_PREVIEW_ROLE_COOKIE);
  }
  cookieStore.delete(ROLE_PREVIEW_TECHNICIAN_COOKIE);

  const supabase = await createClient();
  await addAuditLog(supabase, {
    actor_user_id: user.user_id,
    location_id: locationId,
    action: "location_switched",
    entity_type: "location",
    entity_id: locationId,
    description: "Active location switched",
    old_value: previousLocationId ? { location_id: previousLocationId } : null,
    new_value: { location_id: locationId },
  });

  revalidatePath("/", "layout");
}
