"use server";

import { revalidatePath } from "next/cache";
import type { UserRole, UserStatus } from "@/lib/database/types";
import {
  linkAppUser,
  setAppUserStatus,
  updateAppUser,
} from "@/lib/services/users";
import { toFormErrorMessage } from "@/lib/services/errors";

export type UserFormState = { error: string | null };

function readLocationIds(formData: FormData): string[] {
  return formData
    .getAll("location_ids")
    .map((value) => String(value))
    .filter(Boolean);
}

export async function linkAppUserAction(
  _prevState: UserFormState,
  formData: FormData
): Promise<UserFormState> {
  try {
    await linkAppUser({
      auth_user_id: String(formData.get("auth_user_id") ?? "").trim(),
      first_name: String(formData.get("first_name") ?? "").trim(),
      last_name: String(formData.get("last_name") ?? "").trim(),
      email: String(formData.get("email") ?? "").trim(),
      phone: String(formData.get("phone") ?? "").trim() || null,
      role: String(formData.get("role") ?? "") as UserRole,
      location_ids: readLocationIds(formData),
    });
  } catch (error) {
    return { error: toFormErrorMessage(error) };
  }
  revalidatePath("/settings/users");
  revalidatePath("/settings/locations");
  return { error: null };
}

export async function updateAppUserAction(
  userId: string,
  _prevState: UserFormState,
  formData: FormData
): Promise<UserFormState> {
  try {
    await updateAppUser(userId, {
      first_name: String(formData.get("first_name") ?? "").trim(),
      last_name: String(formData.get("last_name") ?? "").trim(),
      email: String(formData.get("email") ?? "").trim(),
      phone: String(formData.get("phone") ?? "").trim() || null,
      role: String(formData.get("role") ?? "") as UserRole,
      status: String(formData.get("status") ?? "") as UserStatus,
      location_ids: readLocationIds(formData),
    });
  } catch (error) {
    return { error: toFormErrorMessage(error) };
  }
  revalidatePath("/settings/users");
  revalidatePath("/settings/locations");
  return { error: null };
}

export async function setAppUserStatusAction(
  userId: string,
  status: UserStatus
): Promise<void> {
  await setAppUserStatus(userId, status);
  revalidatePath("/settings/users");
}
