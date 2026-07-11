"use client";

import { useActionState, useState } from "react";
import type { MotorcycleFormState } from "@/app/(app)/motorcycles/actions";
import type { Motorcycle } from "@/lib/services/motorcycles";
import { FormError, TextAreaField, TextField } from "@/components/forms/Field";
import { SubmitButton } from "@/components/forms/SubmitButton";
import { VinField, type VinAutofillSuggestion } from "@/components/forms/VinField";

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

function isBlank(value: string): boolean {
  return !value.trim();
}

export function MotorcycleForm({
  action,
  customers,
  motorcycle,
  defaultCustomerId,
  submitLabel,
}: Props) {
  const [state, formAction] = useActionState(action, { error: null });
  const selectedCustomerId = motorcycle?.customer_id ?? defaultCustomerId;

  const [year, setYear] = useState(
    motorcycle?.year != null ? String(motorcycle.year) : ""
  );
  const [make, setMake] = useState(motorcycle?.make ?? "");
  const [model, setModel] = useState(motorcycle?.model ?? "");
  const [touched, setTouched] = useState({
    year: Boolean(motorcycle?.year),
    make: Boolean(motorcycle?.make),
    model: Boolean(motorcycle?.model),
  });

  function applyVinSuggestion(suggestion: VinAutofillSuggestion) {
    if (suggestion.year && (isBlank(year) || !touched.year)) {
      setYear(suggestion.year);
    }
    if (suggestion.make && (isBlank(make) || !touched.make)) {
      setMake(suggestion.make);
    }
    if (suggestion.model && (isBlank(model) || !touched.model)) {
      setModel(suggestion.model);
    }
  }

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

      <VinField
        defaultValue={motorcycle?.vin}
        onSuggestion={applyVinSuggestion}
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <label className="block">
          <span className="field-label">
            Year<span className="ml-1 text-[var(--status-danger)]">*</span>
          </span>
          <input
            className="input"
            name="year"
            type="number"
            required
            value={year}
            onChange={(event) => {
              setYear(event.target.value);
              setTouched((prev) => ({ ...prev, year: true }));
            }}
          />
        </label>
        <label className="block">
          <span className="field-label">
            Make<span className="ml-1 text-[var(--status-danger)]">*</span>
          </span>
          <input
            className="input"
            name="make"
            required
            value={make}
            onChange={(event) => {
              setMake(event.target.value);
              setTouched((prev) => ({ ...prev, make: true }));
            }}
          />
        </label>
        <label className="block">
          <span className="field-label">
            Model<span className="ml-1 text-[var(--status-danger)]">*</span>
          </span>
          <input
            className="input"
            name="model"
            required
            value={model}
            onChange={(event) => {
              setModel(event.target.value);
              setTouched((prev) => ({ ...prev, model: true }));
            }}
          />
        </label>
      </div>

      <TextField label="Colour" name="colour" defaultValue={motorcycle?.colour} />

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
