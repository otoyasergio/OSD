"use client";

import { useActionState } from "react";
import type { MotorcycleFormState } from "@/app/(app)/motorcycles/actions";
import type { Motorcycle } from "@/lib/services/motorcycles";
import { FormError, TextAreaField, TextField } from "@/components/forms/Field";
import { SubmitButton } from "@/components/forms/SubmitButton";

export type CustomerOption = {
  customer_id: string;
  first_name: string;
  last_name: string;
};

type Props = {
  action: (
    state: MotorcycleFormState,
    formData: FormData
  ) => Promise<MotorcycleFormState>;
  customers: CustomerOption[];
  motorcycle?: Motorcycle;
  defaultCustomerId?: string;
  submitLabel: string;
};

export function MotorcycleForm({
  action,
  customers,
  motorcycle,
  defaultCustomerId,
  submitLabel,
}: Props) {
  const [state, formAction] = useActionState(action, { error: null });
  const selectedCustomerId = motorcycle?.customer_id ?? defaultCustomerId;

  return (
    <form action={formAction} className="flex max-w-2xl flex-col gap-4">
      <FormError message={state.error} />

      <label className="block">
        <span className="mb-1.5 block text-sm font-medium text-zinc-800">
          Customer<span className="ml-1 text-red-600">*</span>
        </span>
        <select
          name="customer_id"
          required
          defaultValue={selectedCustomerId ?? ""}
          className="min-h-11 w-full rounded border border-zinc-300 bg-white px-3 py-2 text-base text-zinc-900 outline-none focus:border-zinc-900"
        >
          <option value="" disabled>
            Select a customer
          </option>
          {customers.map((customer) => (
            <option key={customer.customer_id} value={customer.customer_id}>
              {customer.first_name} {customer.last_name}
            </option>
          ))}
        </select>
      </label>

      <div className="grid gap-4 sm:grid-cols-3">
        <TextField
          label="Year"
          name="year"
          type="number"
          required
          defaultValue={motorcycle?.year}
        />
        <TextField
          label="Make"
          name="make"
          required
          defaultValue={motorcycle?.make}
        />
        <TextField
          label="Model"
          name="model"
          required
          defaultValue={motorcycle?.model}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label="VIN"
          name="vin"
          defaultValue={motorcycle?.vin}
          hint="Optional, but missing VIN is flagged in the shop"
        />
        <TextField label="Colour" name="colour" defaultValue={motorcycle?.colour} />
      </div>

      <TextAreaField
        label="Internal notes"
        name="notes"
        defaultValue={motorcycle?.notes}
      />

      <div>
        <SubmitButton label={submitLabel} pendingLabel="Saving…" />
      </div>
    </form>
  );
}
