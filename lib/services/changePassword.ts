import { getCurrentAppUser } from "@/lib/auth/session";
import { createClient } from "@/lib/database/supabase-server";
import { canChangeOwnPassword } from "@/lib/permissions/checks";

export const MIN_PASSWORD_LENGTH = 8;

export type ChangePasswordInput = {
  current_password: string;
  new_password: string;
  confirm_password: string;
};

/** Pure input checks — shared by the service and unit tests. */
export function validatePasswordChangeInput(input: ChangePasswordInput): void {
  const currentPassword = input.current_password.trim();
  const newPassword = input.new_password;
  const confirmPassword = input.confirm_password;

  if (!currentPassword) throw new Error("CURRENT_PASSWORD_REQUIRED");
  if (!newPassword) throw new Error("NEW_PASSWORD_REQUIRED");
  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    throw new Error("NEW_PASSWORD_TOO_SHORT");
  }
  if (newPassword !== confirmPassword) throw new Error("PASSWORD_CONFIRM_MISMATCH");
  if (newPassword === currentPassword) throw new Error("PASSWORD_UNCHANGED");
}

export async function changeOwnPassword(input: ChangePasswordInput): Promise<void> {
  const user = await getCurrentAppUser();
  if (!user) throw new Error("UNAUTHORIZED");
  if (!canChangeOwnPassword(user.role)) throw new Error("FORBIDDEN");

  validatePasswordChangeInput(input);

  const currentPassword = input.current_password.trim();
  const newPassword = input.new_password;

  const supabase = await createClient();

  const { error: verifyError } = await supabase.auth.signInWithPassword({
    email: user.email,
    password: currentPassword,
  });
  if (verifyError) throw new Error("CURRENT_PASSWORD_INVALID");

  const { error: updateError } = await supabase.auth.updateUser({
    password: newPassword,
    current_password: currentPassword,
  });
  if (updateError) {
    throw new Error(updateError.message || "PASSWORD_UPDATE_FAILED");
  }
}
