"use client";

import { useActionState, useEffect, useRef } from "react";
import type { ShopClosureFormState } from "@/app/(app)/settings/closures/actions";
import { FormError, TextField } from "@/components/forms/Field";
import { SubmitButton } from "@/components/forms/SubmitButton";

type Action = (
  state: ShopClosureFormState,
  formData: FormData
) => Promise<ShopClosureFormState>;

export function ShopClosureForm({ action }: { action: Action }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction] = useActionState(action, {
    error: null,
    saved: false,
  });

  useEffect(() => {
    if (state.saved) formRef.current?.reset();
  }, [state.saved]);

  return (
    <form
      ref={formRef}
      action={formAction}
      className="flex flex-col gap-4 rounded border border-[var(--border)] bg-white p-4"
    >
      <div>
        <h2 className="font-semibold text-foreground">Add closure date</h2>
        <p className="mt-1 text-sm text-[var(--status-neutral)]">
          New intakes will skip this date when choosing their default completion time.
        </p>
      </div>
      <FormError message={state.error} />
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField label="Closed on" name="closure_date" type="date" required />
        <TextField
          label="Reason"
          name="reason"
          maxLength={120}
          placeholder="Holiday, staff event…"
        />
      </div>
      <div>
        <SubmitButton label="Add closure" pendingLabel="Adding…" />
      </div>
    </form>
  );
}
