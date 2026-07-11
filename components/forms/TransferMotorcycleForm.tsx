"use client";

import { useActionState, useMemo, useState } from "react";
import type { MotorcycleFormState } from "@/app/(app)/motorcycles/actions";
import type { CustomerOption } from "@/components/forms/MotorcycleForm";
import { FormError } from "@/components/forms/Field";
import { SubmitButton } from "@/components/forms/SubmitButton";

type Props = {
  action: (
    state: MotorcycleFormState,
    formData: FormData
  ) => Promise<MotorcycleFormState>;
  customers: CustomerOption[];
  currentCustomerId: string;
  currentCustomerName: string;
  bikeLabel: string;
};

export function TransferMotorcycleForm({
  action,
  customers,
  currentCustomerId,
  currentCustomerName,
  bikeLabel,
}: Props) {
  const [state, formAction] = useActionState(action, { error: null });
  const [selectedId, setSelectedId] = useState("");
  const [confirmed, setConfirmed] = useState(false);

  const candidates = useMemo(
    () => customers.filter((c) => c.customer_id !== currentCustomerId),
    [customers, currentCustomerId]
  );

  const selected = candidates.find((c) => c.customer_id === selectedId);
  const selectedName = selected
    ? `${selected.first_name} ${selected.last_name}`
    : "";

  return (
    <form action={formAction} className="flex max-w-2xl flex-col gap-4">
      <FormError message={state.error} />

      <p className="text-sm text-zinc-600">
        Move this motorcycle to another customer&apos;s garage. The bike keeps
        the same ID, VIN, service information, and work-order history. Past work
        orders stay with the visit customer who owned the bike at the time.
      </p>

      <label className="block">
        <span className="mb-1.5 block text-sm font-medium text-zinc-800">
          New owner<span className="ml-1 text-red-600">*</span>
        </span>
        <select
          name="new_customer_id"
          required
          value={selectedId}
          onChange={(event) => {
            setSelectedId(event.target.value);
            setConfirmed(false);
          }}
          className="min-h-11 w-full rounded border border-zinc-300 bg-white px-3 py-2 text-base text-zinc-900 outline-none focus:border-zinc-900"
        >
          <option value="" disabled>
            Select a customer
          </option>
          {candidates.map((customer) => (
            <option key={customer.customer_id} value={customer.customer_id}>
              {customer.first_name} {customer.last_name}
            </option>
          ))}
        </select>
      </label>

      {candidates.length === 0 ? (
        <p className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          No other customers on file.{" "}
          <a href="/customers/new" className="font-semibold underline-offset-2 hover:underline">
            Create a customer
          </a>{" "}
          first, then transfer.
        </p>
      ) : null}

      {selected ? (
        <label className="flex items-start gap-3 rounded border border-zinc-200 bg-zinc-50 px-3 py-3 text-sm text-zinc-800">
          <input
            type="checkbox"
            className="mt-1"
            checked={confirmed}
            onChange={(event) => setConfirmed(event.target.checked)}
            required
          />
          <span>
            Transfer <strong>{bikeLabel}</strong> from{" "}
            <strong>{currentCustomerName}</strong> to{" "}
            <strong>{selectedName}</strong>? Past work orders stay with the visit
            history.
          </span>
        </label>
      ) : null}

      <div>
        <SubmitButton
          label="Transfer ownership"
          pendingLabel="Transferring…"
          disabled={!selectedId || !confirmed}
        />
      </div>
    </form>
  );
}
