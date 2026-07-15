"use client";

import { useActionState, useState } from "react";
import type { CustomerFormState } from "@/app/(app)/customers/actions";
import type { Customer } from "@/lib/services/customers";
import { CUSTOMER_ACCOUNT_TYPE_LABELS } from "@/lib/services/customerShared";
import { FormError, TextField } from "@/components/forms/Field";
import { SubmitButton } from "@/components/forms/SubmitButton";
import { DocumentScanCapture } from "@/components/scan/DocumentScanCapture";

type Props = {
  action: (state: CustomerFormState, formData: FormData) => Promise<CustomerFormState>;
  customer?: Customer;
  submitLabel: string;
  /** Optional DL scan (front office create/edit only). */
  enableDocumentScan?: boolean;
};

export function CustomerForm({
  action,
  customer,
  submitLabel,
  enableDocumentScan = true,
}: Props) {
  const [state, formAction] = useActionState(action, { error: null });
  const fieldErrors = state.fieldErrors ?? {};
  const [firstName, setFirstName] = useState(customer?.first_name ?? "");
  const [lastName, setLastName] = useState(customer?.last_name ?? "");
  const [notes, setNotes] = useState(customer?.notes ?? "");

  return (
    <form action={formAction} className="flex max-w-2xl flex-col gap-4">
      <FormError message={state.error} />

      {enableDocumentScan ? (
        <DocumentScanCapture
          mode="driver_license"
          onConfirm={(draft) => {
            if (draft.first_name) setFirstName(draft.first_name);
            if (draft.last_name) setLastName(draft.last_name);
            if (draft.raw_notes) {
              setNotes((prev) =>
                prev?.trim()
                  ? `${prev.trim()}\n${draft.raw_notes}`
                  : (draft.raw_notes ?? "")
              );
            }
          }}
        />
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="field-label">
            First name<span className="ml-1 text-red-600">*</span>
          </span>
          <input
            name="first_name"
            required
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            className="input"
          />
          {fieldErrors.first_name ? (
            <p className="mt-1 text-sm text-red-700">{fieldErrors.first_name}</p>
          ) : null}
        </label>
        <label className="block">
          <span className="field-label">
            Last name<span className="ml-1 text-red-600">*</span>
          </span>
          <input
            name="last_name"
            required
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            className="input"
          />
          {fieldErrors.last_name ? (
            <p className="mt-1 text-sm text-red-700">{fieldErrors.last_name}</p>
          ) : null}
        </label>
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

      <label className="block">
        <span className="field-label">Notes</span>
        <textarea
          name="notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="input min-h-24"
        />
        {fieldErrors.notes ? (
          <p className="mt-1 text-sm text-red-700">{fieldErrors.notes}</p>
        ) : null}
      </label>

      <div>
        <SubmitButton label={submitLabel} pendingLabel="Saving…" />
      </div>
    </form>
  );
}
