"use client";

import { useActionState } from "react";
import type { ShopRateFormState } from "@/app/(app)/settings/shop_rate/actions";
import { FormError, TextField } from "@/components/forms/Field";
import { MAX_SHOP_HOURLY_RATE } from "@/lib/pricing/shopRate";
import { SubmitButton } from "@/components/forms/SubmitButton";

type Action = (
  state: ShopRateFormState,
  formData: FormData
) => Promise<ShopRateFormState>;

export function ShopRateForm({
  hourlyRate,
  locationName,
  action,
}: {
  hourlyRate: number;
  locationName: string;
  action: Action;
}) {
  const [state, formAction] = useActionState(action, {
    error: null,
    saved: false,
  });

  return (
    <form
      action={formAction}
      className="flex max-w-lg flex-col gap-4 rounded border border-[var(--border)] bg-white p-4"
    >
      <div>
        <h2 className="font-semibold text-foreground">Hourly labour rate</h2>
        <p className="mt-1 text-sm text-[var(--status-neutral)]">
          Pre-tax dollars per hour for {locationName}. HST is added on the invoice.
        </p>
      </div>
      <FormError message={state.error} />
      {state.saved ? (
        <p className="text-sm text-[var(--status-success)]" role="status">
          Shop rate saved.
        </p>
      ) : null}
      <TextField
        label="Shop rate"
        name="hourly_rate"
        type="number"
        required
        defaultValue={hourlyRate}
        inputMode="decimal"
        min={0.01}
        max={MAX_SHOP_HOURLY_RATE}
        step={0.01}
        hint="Used when intake prices labour by the hour."
      />
      <div>
        <SubmitButton label="Save shop rate" pendingLabel="Saving…" />
      </div>
    </form>
  );
}
