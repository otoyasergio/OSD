"use client";

import { useEffect, useId, useState, useTransition } from "react";
import {
  loadStorageChecklistAction,
  placeBikeInStorageAction,
} from "@/app/(app)/work_orders/storage-actions";
import type { StorageChecklistSnapshot } from "@/lib/services/storageChecklist";
import { parseStorageMonthlyCents, parseStoragePickupDate } from "@/lib/storage/terms";

type Props = {
  workOrderId: string;
  targetColumnId: string;
  bikeLabel: string;
  onClose: () => void;
  onStored: (terms: { pickupBy: string; monthlyCents: number }) => void;
};

export function StorageChecklistDialog({
  workOrderId,
  targetColumnId,
  bikeLabel,
  onClose,
  onStored,
}: Props) {
  const titleId = useId();
  const [checklist, setChecklist] = useState<StorageChecklistSnapshot | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pickupBy, setPickupBy] = useState("");
  const [monthlyAmount, setMonthlyAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;
    void loadStorageChecklistAction(workOrderId).then((result) => {
      if (cancelled) return;
      setChecklist(result.checklist);
      setLoadError(result.error);
    });
    return () => {
      cancelled = true;
    };
  }, [workOrderId]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !pending) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, pending]);

  const today = checklist?.today ?? "";
  const monthlyCents = parseStorageMonthlyCents(monthlyAmount);
  const dateOk = today ? parseStoragePickupDate(pickupBy, today) != null : false;
  const canConfirm = Boolean(checklist?.canStore) && dateOk && monthlyCents != null && !pending;

  function confirm() {
    if (monthlyCents == null) return;
    setError(null);
    startTransition(async () => {
      const result = await placeBikeInStorageAction({
        workOrderId,
        targetColumnId,
        pickupBy,
        monthlyCents,
      });
      if (result.error) {
        setError(result.error);
        return;
      }
      onStored({ pickupBy, monthlyCents });
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
      onClick={() => {
        if (!pending) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid="storage-checklist-dialog"
        className="card card-pad w-full max-w-md"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id={titleId} className="text-lg font-semibold text-foreground">
          Store {bikeLabel}?
        </h2>
        <p className="mt-2 text-sm text-foreground">
          This bike can go into storage after the inspection, the estimate, and the
          approved work are finished.
        </p>
        {loadError ? (
          <p className="mt-3 text-sm text-red-700" role="alert">
            {loadError}
          </p>
        ) : null}
        {!checklist && !loadError ? (
          <p className="mt-3 text-sm text-[var(--status-neutral)]">Checking the work order…</p>
        ) : null}
        {checklist ? (
          <ul className="mt-3 space-y-2 text-sm text-foreground">
            <CheckLine label="Arrival inspection" done={checklist.inspectionDone} />
            <CheckLine
              label="Estimate decided"
              done={checklist.awaitingApproval.length === 0}
              detail={checklist.awaitingApproval.map((line) => line.name).join(", ")}
            />
            <CheckLine
              label="Approved work finished"
              done={
                checklist.unfinishedApproved.length === 0 &&
                checklist.partsOutstanding.length === 0
              }
              detail={[
                ...checklist.unfinishedApproved.map((line) => line.name),
                ...checklist.partsOutstanding.map(
                  (line) => `${line.name} (${line.detail ?? "open"})`
                ),
              ].join(", ")}
            />
            {checklist.phoneMissing ? (
              <li>No phone number on file. The month-left text cannot be sent.</li>
            ) : null}
          </ul>
        ) : null}
        <div className="mt-4 grid gap-3">
          <label className="block">
            <span className="field-label">Pickup by</span>
            <input
              type="date"
              className="min-h-11 w-full rounded border border-[var(--border-strong)] px-3"
              min={today || undefined}
              value={pickupBy}
              onChange={(event) => setPickupBy(event.target.value)}
              required
            />
          </label>
          <label className="block">
            <span className="field-label">How much is monthly storage?</span>
            <input
              inputMode="decimal"
              className="min-h-11 w-full rounded border border-[var(--border-strong)] px-3"
              placeholder="0.00"
              value={monthlyAmount}
              onChange={(event) => setMonthlyAmount(event.target.value)}
              required
            />
          </label>
        </div>
        {error ? (
          <p className="mt-3 text-sm text-red-700" role="alert">
            {error}
          </p>
        ) : null}
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            className="btn btn-secondary min-h-11"
            disabled={pending}
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary min-h-11"
            data-testid="storage-checklist-confirm"
            disabled={!canConfirm}
            onClick={confirm}
          >
            {pending ? "Saving…" : "Store the bike"}
          </button>
        </div>
      </div>
    </div>
  );
}

function CheckLine({
  label,
  done,
  detail,
}: {
  label: string;
  done: boolean;
  detail?: string;
}) {
  return (
    <li>
      <span className="font-semibold">{done ? "Done" : "Not done"}:</span> {label}
      {!done && detail ? <span className="text-[var(--status-neutral)]"> — {detail}</span> : null}
    </li>
  );
}
