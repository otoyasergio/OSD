"use server";

import { changeOwnPassword } from "@/lib/services/changePassword";
import { toFormErrorMessage } from "@/lib/services/errors";

export type PasswordFormState = {
  error: string | null;
  success: boolean;
  /** Bumps on success so the client form remounts and clears fields. */
  resetKey: number;
};

export async function changeOwnPasswordAction(
  prevState: PasswordFormState,
  formData: FormData
): Promise<PasswordFormState> {
  try {
    await changeOwnPassword({
      current_password: String(formData.get("current_password") ?? ""),
      new_password: String(formData.get("new_password") ?? ""),
      confirm_password: String(formData.get("confirm_password") ?? ""),
    });
  } catch (error) {
    return {
      error: toFormErrorMessage(error),
      success: false,
      resetKey: prevState.resetKey,
    };
  }

  return {
    error: null,
    success: true,
    resetKey: prevState.resetKey + 1,
  };
}
