"use client";

import { useActionState } from "react";
import type { CustomerFormState } from "@/app/(app)/customers/actions";
import type { Customer } from "@/lib/services/customers";
import { CUSTOMER_ACCOUNT_TYPE_LABELS } from "@/lib/services/customerShared";
import { FormError, TextAreaField, TextField } from "@/components/forms/Field";
import { SubmitButton } from "@/components/forms/SubmitButton";

type Props = {
  action: (state: CustomerFormState, formData: FormData) => Promise<CustomerFormState>;
  customer?: Customer;
  submitLabel: string;
};

export function CustomerForm({ action, customer, submitLabel }: Props) {
  const [state, formAction] = useActionState(action, { error: null });
  const fieldErrors = state.fieldErrors ?? {};

  return (
    <form action={formAction} className="flex max-w-2xl flex-col gap-4">
      <FormError message={state.error} />

      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label="First name"
          name="first_name"
          required
          defaultValue={customer?.first_name}
          error={fieldErrors.first_name}
        />
        <TextField
          label="Last name"
          name="last_name"
          required
          defaultValue={customer?.last_name}
          error={fieldErrors.last_name}
        />
        <TextField
          label="Phone"
          name="phone"
          type="tel"
          defaultValue={customer?.phone}
          hint="Phone or email is required"
          error={fieldErrors.phone}
        />
        <TextField
          label="Email"
          name="email"
          type="email"
          defaultValue={customer?.email}
          error={fieldErrors.email}
        />
      </div>

      <label htmlFor="account_type" className="block">
        <span className="field-label">Account type</span>
        <select
          id="account_type"
          name="account_type"
          defaultValue={customer?.account_type ?? "retail"}
          className="input"
        >
          {(
            Object.keys(CUSTOMER_ACCOUNT_TYPE_LABELS) as Array<
              keyof typeof CUSTOMER_ACCOUNT_TYPE_LABELS
            >
          ).map((value) => (
            <option key={value} value={value}>
              {CUSTOMER_ACCOUNT_TYPE_LABELS[value]}
            </option>
          ))}
        </select>
      </label>

      <TextAreaField
        label="Notes"
        name="notes"
        defaultValue={customer?.notes}
        error={fieldErrors.notes}
      />

      <div>
        <SubmitButton label={submitLabel} pendingLabel="Saving…" />
      </div>
    </form>
  );
}
