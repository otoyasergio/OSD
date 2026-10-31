"use client";

import { useActionState } from "react";
import type { PassportActionState } from "@/app/(app)/motorcycles/[motorcycle_id]/passport/actions";
import { FormError } from "@/components/forms/Field";
import { SubmitButton } from "@/components/forms/SubmitButton";

const INITIAL_STATE: PassportActionState = {
  error: null,
  message: null,
  shareUrl: null,
  shareExpiresAt: null,
};

type Props = {
  action: (
    state: PassportActionState,
    formData: FormData
  ) => Promise<PassportActionState>;
  reportVersion: number;
  replacesPublishedVersion: boolean;
};

export function PassportPublishForm({
  action,
  reportVersion,
  replacesPublishedVersion,
}: Props) {
  const [state, formAction] = useActionState(action, INITIAL_STATE);

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <FormError message={state.error} />
      {state.message ? (
        <p
          role="status"
          className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900"
        >
          {state.message}
        </p>
      ) : null}
      <p className="text-sm text-[var(--status-neutral)]">
        Publishing freezes exactly the preview below as version {reportVersion}.
        {replacesPublishedVersion
          ? " The current version becomes superseded and its active link is revoked."
          : " No public link is created until you issue one separately."}
      </p>
      <div>
        <SubmitButton
          label={`Publish version ${reportVersion}`}
          pendingLabel="Publishing…"
          variant="accent"
        />
      </div>
    </form>
  );
}
