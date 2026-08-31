"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/database/supabase-server";
import {
  ROLE_PREVIEW_ROLE_COOKIE,
  ROLE_PREVIEW_TECHNICIAN_COOKIE,
} from "@/lib/auth/role-preview-shared";

export async function signOutAction() {
  const cookieStore = await cookies();
  cookieStore.delete(ROLE_PREVIEW_ROLE_COOKIE);
  cookieStore.delete(ROLE_PREVIEW_TECHNICIAN_COOKIE);

  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
