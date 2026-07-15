"use client";

import { useActionState, useState, useTransition } from "react";
import type { MotorcycleFormState } from "@/app/(app)/motorcycles/actions";
import {
  acceptVinTransferAction,
  lookupVinOwnershipAction,
} from "@/app/(app)/motorcycles/actions";
import type { Motorcycle } from "@/lib/services/motorcycles";
import type { VinOwnershipConflict } from "@/lib/services/motorcycles";
import { FormError, TextAreaField, TextField } from "@/components/forms/Field";
import { SubmitButton } from "@/components/forms/SubmitButton";
import { VinField, type VinAutofillSuggestion } from "@/components/forms/VinField";
import { VinOwnershipConflictNotice } from "@/components/forms/VinOwnershipConflictNotice";
import { MileageUnitToggle } from "@/components/forms/MileageUnitToggle";
import { normalizeMileageUnit } from "@/lib/mileage/format";

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
  /** Prefill when creating from a VIN lookup (intake). */
  defaults?: {
    vin?: string;
    year?: string;
    make?: string;
    model?: string;
  };
  /** After create, redirect here (intake deep link) with motorcycle_id added. */
  returnTo?: string;
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
  defaults,
  returnTo,
  submitLabel,
}: Props) {
  const [state, formAction] = useActionState(action, { error: null });
  const selectedCustomerId = motorcycle?.customer_id ?? defaultCustomerId;

  const [customerId, setCustomerId] = useState(selectedCustomerId ?? "");
  const [year, setYear] = useState(
    motorcycle?.year != null ? String(motorcycle.year) : (defaults?.year ?? "")
  );
  const [make, setMake] = useState(motorcycle?.make ?? defaults?.make ?? "");
  const [model, setModel] = useState(motorcycle?.model ?? defaults?.model ?? "");
  const [odometerUnit, setOdometerUnit] = useState(() =>
    normalizeMileageUnit(motorcycle?.odometer_unit)
  );
  const [vinKey, setVinKey] = useState(0);
  const [touched, setTouched] = useState({
    year: Boolean(motorcycle?.year ?? defaults?.year),
    make: Boolean(motorcycle?.make ?? defaults?.make),
    model: Boolean(motorcycle?.model ?? defaults?.model),
  });

  const [conflict, setConflict] = useState<VinOwnershipConflict | null>(null);
  const [transferError, setTransferError] = useState<string | null>(null);
  const [transferPending, startTransfer] = useTransition();

  const currentCustomer = customers.find((c) => c.customer_id === customerId);
  const currentCustomerName = currentCustomer
    ? `${currentCustomer.first_name} ${currentCustomer.last_name}`
    : undefined;

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

  async function checkVinOwnership(vin: string | null) {
    setTransferError(null);
    if (!vin || !customerId) {
      setConflict(null);
      return;
    }
    const result = await lookupVinOwnershipAction({
      vin,
      currentCustomerId: customerId,
      excludeMotorcycleId: motorcycle?.motorcycle_id,
    });
    setConflict(result);
  }

  function clearVin() {
    setConflict(null);
    setTransferError(null);
    setVinKey((k) => k + 1);
  }

  function acceptTransfer() {
    if (!conflict || !customerId) return;
    startTransfer(async () => {
      const result = await acceptVinTransferAction({
        motorcycle_id: conflict.motorcycle_id,
        new_customer_id: customerId,
      });
      if (result?.error) {
        setTransferError(result.error);
      }
    });
  }

  return (
    <form action={formAction} className="flex max-w-2xl flex-col gap-4">
      <FormError message={state.error} />
      {returnTo ? <input type="hidden" name="return_to" value={returnTo} /> : null}

      <label className="block">
        <span className="mb-1.5 block text-sm font-medium text-foreground">
          Customer<span className="ml-1 text-red-600">*</span>
        </span>
        <select
          name="customer_id"
          required
          value={customerId}
          onChange={(event) => {
            setCustomerId(event.target.value);
            // Re-check when customer changes while a conflict VIN may still be present.
            setConflict(null);
          }}
          className="min-h-11 w-full rounded border border-[var(--border-strong)] bg-white px-3 py-2 text-base text-foreground outline-none focus:border-[var(--accent)]"
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
        key={vinKey}
        defaultValue={motorcycle?.vin ?? defaults?.vin}
        onSuggestion={applyVinSuggestion}
        onVinReady={checkVinOwnership}
      />

      {conflict ? (
        <VinOwnershipConflictNotice
          conflict={conflict}
          currentCustomerName={currentCustomerName}
          pending={transferPending}
          error={transferError}
          onAccept={acceptTransfer}
          onDecline={clearVin}
        />
      ) : null}

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

      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label="Colour" name="colour" defaultValue={motorcycle?.colour} />
        <TextField
          label="Plate number (optional)"
          name="plate_number"
          defaultValue={motorcycle?.plate_number}
          maxLength={20}
          autoCapitalize="characters"
          autoComplete="off"
          hint="Saved in uppercase."
        />
      </div>

      <MileageUnitToggle
        name="odometer_unit"
        label="Odometer unit"
        value={odometerUnit}
        onChange={setOdometerUnit}
      />

      <TextAreaField
        label="Internal notes"
        name="notes"
        defaultValue={motorcycle?.notes}
      />

      <div>
        <SubmitButton
          label={submitLabel}
          pendingLabel="Saving…"
          disabled={Boolean(conflict) || transferPending}
        />
        {conflict ? (
          <p className="mt-2 text-xs text-[var(--status-neutral)]">
            Resolve the VIN ownership notice before saving a new motorcycle.
          </p>
        ) : null}
      </div>
    </form>
  );
}
