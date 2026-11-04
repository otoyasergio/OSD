"use client";

import { useActionState, useState } from "react";
import type { CustomerFormState } from "@/app/(app)/customers/actions";
import type { Customer } from "@/lib/services/customers";
import { CUSTOMER_ACCOUNT_TYPE_LABELS } from "@/lib/services/customerShared";
import { FormError, TextAreaField, TextField } from "@/components/forms/Field";
import { SubmitButton } from "@/components/forms/SubmitButton";
import { AddressAutocomplete } from "@/components/forms/AddressAutocomplete";
import { PhoneField } from "@/components/forms/PhoneField";
import { EmailField } from "@/components/forms/EmailField";
import { CustomerDuplicateWarning } from "@/components/forms/CustomerDuplicateWarning";
import { LicenceBarcodeScan } from "@/components/customers/LicenceBarcodeScan";
import type { LicenceScan } from "@/lib/id/aamva";

type Props = {
  action: (state: CustomerFormState, formData: FormData) => Promise<CustomerFormState>;
  customer?: Customer;
  submitLabel: string;
  /** Safe in-app path to resume after create (e.g. /work_orders/new). */
  returnTo?: string;
};

export function CustomerForm({ action, customer, submitLabel, returnTo }: Props) {
  const [state, formAction] = useActionState(action, { error: null });
  const fieldErrors = state.fieldErrors ?? {};
  const accountType = customer?.account_type ?? "retail";
  const hasExistingNotes = Boolean(customer?.notes?.trim());
  const [phoneValue, setPhoneValue] = useState(customer?.phone ?? "");
  const [emailValue, setEmailValue] = useState(customer?.email ?? "");
  const [scan, setScan] = useState<LicenceScan | null>(null);

  return (
    <form action={formAction} className="flex max-w-3xl flex-col gap-4">
      {returnTo ? <input type="hidden" name="return_to" value={returnTo} /> : null}
      <FormError message={state.error} />
      <LicenceBarcodeScan onConfirm={setScan} />
      {scan ? (
        <>
          <input type="hidden" name="licence_number" value={scan.licenceNumber} />
          <input type="hidden" name="licence_expiry" value={scan.licenceExpiry} />
        </>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label="First name"
          name="first_name"
          required
          autoComplete="given-name"
          autoCapitalize="words"
          autoCorrect="off"
          autoFocus={!customer}
          defaultValue={scan?.firstName || customer?.first_name}
          key={`first-${scan?.licenceNumber ?? "saved"}`}
          error={fieldErrors.first_name}
        />
        <TextField
          label="Last name"
          name="last_name"
          required
          autoComplete="family-name"
          autoCapitalize="words"
          autoCorrect="off"
          defaultValue={scan?.lastName || customer?.last_name}
          key={`last-${scan?.licenceNumber ?? "saved"}`}
          error={fieldErrors.last_name}
        />
        <PhoneField
          defaultValue={customer?.phone}
          error={fieldErrors.phone}
          onValueChange={setPhoneValue}
        />
        <EmailField
          defaultValue={customer?.email}
          error={fieldErrors.email}
          onValueChange={setEmailValue}
        />
        <CustomerDuplicateWarning
          phone={phoneValue}
          email={emailValue}
          excludeCustomerId={customer?.customer_id}
        />
        <div className="sm:col-span-2">
          <AddressAutocomplete
            defaultValue={scan?.address || customer?.address}
            key={`address-${scan?.licenceNumber ?? "saved"}`}
            error={fieldErrors.address}
          />
        </div>
        <TextField
          label="Birthday (optional)"
          name="date_of_birth"
          type="date"
          defaultValue={scan?.dateOfBirth || customer?.date_of_birth}
          key={`dob-${scan?.licenceNumber ?? "saved"}`}
          autoComplete="bday"
          error={fieldErrors.date_of_birth}
        />
      </div>

      <details
        open={Boolean(customer && (accountType !== "retail" || hasExistingNotes))}
        className="rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] px-4 py-2"
      >
        <summary className="cursor-pointer text-sm font-medium text-foreground">
          More details
          <span className="ml-2 font-normal text-[var(--status-neutral)]">
            {CUSTOMER_ACCOUNT_TYPE_LABELS[accountType]}
          </span>
        </summary>
        <label htmlFor="account_type" className="mt-3 block max-w-sm pb-2">
          <span className="field-label">Account type</span>
          <select
            id="account_type"
            name="account_type"
            defaultValue={accountType}
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
        <div className="max-w-2xl pb-2">
          <TextAreaField
            label="Notes (optional)"
            name="notes"
            rows={2}
            defaultValue={customer?.notes}
            error={fieldErrors.notes}
          />
        </div>
      </details>

      <div>
        <SubmitButton label={submitLabel} pendingLabel="Saving…" />
      </div>
    </form>
  );
}
