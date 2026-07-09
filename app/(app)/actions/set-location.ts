"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { ACTIVE_LOCATION_COOKIE } from "@/lib/auth/location-cookie";
import { getCurrentAppUser } from "@/lib/auth/session";

export async function setActiveLocation(locationId: string) {
  const user = await getCurrentAppUser();
  if (!user) throw new Error("UNAUTHORIZED");
  if (!user.location_ids.includes(locationId)) throw new Error("FORBIDDEN");

  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_LOCATION_COOKIE, locationId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
  });

  // audit: location_switched (wire fully in Task 12)
  revalidatePath("/", "layout");
}
