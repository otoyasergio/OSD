"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { getCurrentAppUser } from "@/lib/auth/session";
import { findEligiblePreviewTechnician } from "@/lib/auth/role-preview";
import {
  isRolePreviewRole,
  ROLE_PREVIEW_ROLE_COOKIE,
  ROLE_PREVIEW_TECHNICIAN_COOKIE,
} from "@/lib/auth/role-preview-shared";
import { staffHomePath } from "@/lib/permissions";

const COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
  path: "/",
} as const;

/**
 * Owner-only "view as" selector. Sets HTTP-only preview cookies and returns
 * the selected role's home path so the client can land on a visible surface.
 * Authorization, mutations, and audit stay on the real owner identity.
 */
export async function setRolePreview(input: {
  role: string;
  technicianId?: string | null;
}): Promise<{ home: string }> {
  const user = await getCurrentAppUser();
  if (!user) throw new Error("UNAUTHORIZED");
  if (user.role !== "owner") throw new Error("FORBIDDEN");
  if (!isRolePreviewRole(input.role)) throw new Error("INVALID_ROLE");

  const cookieStore = await cookies();

  if (input.role === "owner") {
    cookieStore.delete(ROLE_PREVIEW_ROLE_COOKIE);
    cookieStore.delete(ROLE_PREVIEW_TECHNICIAN_COOKIE);
    revalidatePath("/", "layout");
    return { home: staffHomePath("owner") };
  }

  if (input.role === "technician") {
    const technician = await findEligiblePreviewTechnician(
      input.technicianId?.trim() ?? "",
      user.active_location_id
    );
    if (!technician) throw new Error("TECHNICIAN_NOT_FOUND");
    cookieStore.set(ROLE_PREVIEW_TECHNICIAN_COOKIE, technician.user_id, COOKIE_OPTIONS);
  } else {
    cookieStore.delete(ROLE_PREVIEW_TECHNICIAN_COOKIE);
  }

  cookieStore.set(ROLE_PREVIEW_ROLE_COOKIE, input.role, COOKIE_OPTIONS);
  revalidatePath("/", "layout");
  return { home: staffHomePath(input.role) };
}
