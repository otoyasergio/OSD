"use client";

import type { VinOwnershipConflict } from "@/lib/services/motorcycles";

type Props = {
  conflict: VinOwnershipConflict;
  currentCustomerName?: string;
  pending?: boolean;
  error?: string | null;
  onAccept: () => void;
  onDecline: () => void;
};

export function VinOwnershipConflictNotice({
  conflict,
  currentCustomerName,
  pending = false,
  error = null,
  onAccept,
  onDecline,
}: Props) {
  return (
    <div
      className="rounded border border-amber-300 bg-amber-50 px-3 py-3 text-sm text-amber-950"
      role="alertdialog"
      aria-labelledby="vin-conflict-title"
      aria-describedby="vin-conflict-copy"
    >
      <p id="vin-conflict-title" className="font-semibold">
        This bike is in someone else&apos;s garage
      </p>
      <p id="vin-conflict-copy" className="mt-1 text-amber-900">
        VIN <span className="font-mono">{conflict.vin}</span> matches{" "}
        <strong>{conflict.bike_label}</strong> owned by{" "}
        <strong>{conflict.owner_name}</strong>
        {currentCustomerName ? (
          <>
            . Transfer it to <strong>{currentCustomerName}</strong>?
          </>
        ) : (
          ". Do you want to transfer it?"
        )}
      </p>
      <p className="mt-1 text-xs text-amber-800">
        Past work orders stay with the visit history. A second motorcycle with
        this VIN will not be created.
      </p>
      {error ? (
        <p className="mt-2 text-sm font-medium text-red-700" role="alert">
          {error}
        </p>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          className="btn btn-primary"
          disabled={pending}
          onClick={onAccept}
        >
          {pending ? "Transferring…" : "Yes, transfer"}
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={pending}
          onClick={onDecline}
        >
          No
        </button>
      </div>
    </div>
  );
}
