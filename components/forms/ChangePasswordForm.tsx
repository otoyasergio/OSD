"use client";

import { useActionState } from "react";
import type { PasswordFormState } from "@/app/(app)/settings/password/actions";
import { FormError, TextField } from "@/components/forms/Field";
import { SubmitButton } from "@/components/forms/SubmitButton";

type Action = (
  state: PasswordFormState,
  formData: FormData
) => Promise<PasswordFormState>;

const INITIAL: PasswordFormState = { error: null, success: false, resetKey: 0 };

export function ChangePasswordForm({ action }: { action: Action }) {
  const [state, formAction] = useActionState(action, INITIAL);

  return (
    <form
      key={state.resetKey}
      action={formAction}
      className="flex max-w-md flex-col gap-3 rounded border border-[var(--border)] bg-white p-4"
    >
      <FormError message={state.error} />
      {state.success ? (
        <p
          role="status"
          className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900"
        >
          Password updated.
        </p>
      ) : null}
      <TextField
        label="Current password"
        name="current_password"
        type="password"
        autoComplete="current-password"
        required
      />
      <TextField
        label="New password"
        name="new_password"
        type="password"
        autoComplete="new-password"
        required
        minLength={8}
        hint="At least 8 characters."
      />
      <TextField
        label="Confirm new password"
        name="confirm_password"
        type="password"
        autoComplete="new-password"
        required
        minLength={8}
      />
      <div>
        <SubmitButton label="Update password" pendingLabel="Updating…" />
      </div>
    </form>
  );
}
