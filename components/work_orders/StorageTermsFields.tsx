"use client";

import { useState, useTransition } from "react";
import { updateStorageTermsAction } from "@/app/(app)/work_orders/storage-actions";
import { formatCalendarDate, shopDateKey } from "@/lib/datetime/format";
import { formatStorageMonthlyAmount } from "@/lib/storage/terms";

export function StorageTermsFields({
  workOrderId,
  pickupBy,
  monthlyCents,
  canEdit,
}: {
  workOrderId: string;
  pickupBy: string | null;
  monthlyCents: number | null;
  canEdit: boolean;
}) {
  const today = shopDateKey(new Date());
  const [date, setDate] = useState(pickupBy ?? "");
  const [amount, setAmount] = useState(
    monthlyCents == null ? "" : (monthlyCents / 100).toFixed(monthlyCents % 100 === 0 ? 0 : 2)
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!canEdit) {
    return (
      <p className="mt-0.5 font-semibold text-foreground">
        {formatCalendarDate(pickupBy) || "—"}
        {monthlyCents == null ? "" : ` · ${formatStorageMonthlyAmount(monthlyCents)} / month after`}
      </p>
    );
  }

  return (
    <form
      className="mt-1 flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        startTransition(async () => {
          const result = await updateStorageTermsAction({
            workOrderId,
            pickupBy: date,
            monthlyAmount: amount,
          });
          setError(result.error);
        });
      }}
    >
      <label className="block">
        <span className="field-label">Pickup by</span>
        <input
          type="date"
          className="min-h-11 w-full rounded border border-[var(--border-strong)] px-3"
          min={today}
          value={date}
          aria-label="Pickup by"
          onChange={(event) => setDate(event.target.value)}
          required
        />
      </label>
      <label className="block">
        <span className="field-label">How much is monthly storage?</span>
        <input
          inputMode="decimal"
          className="min-h-11 w-full rounded border border-[var(--border-strong)] px-3"
          aria-label="How much is monthly storage?"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          required
        />
      </label>
      <button type="submit" className="btn btn-secondary min-h-10 text-sm" disabled={pending}>
        {pending ? "Saving…" : "Save storage terms"}
      </button>
      {error ? (
        <p className="text-sm text-red-700" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}
