"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import type { InspectionResultRow } from "@/lib/services/inspections";
import type { InspectionResultStatus } from "@/lib/database/types";
import { INSPECTION_RESULT_LABELS } from "@/lib/status/labels";
import { saveInspectionResultAction } from "@/app/(app)/work_orders/[work_order_id]/inspection/actions";

type SaveState = "idle" | "saving" | "saved" | "error";

const STATUS_OPTIONS: Array<InspectionResultStatus | null> = [
  null,
  "ok",
  "future_attention",
  "immediate_attention",
];

const STATUS_BUTTON: Record<string, string> = {
  null: "border-zinc-300 bg-white text-zinc-700",
  ok: "border-emerald-600 bg-emerald-50 text-emerald-900",
  future_attention: "border-amber-500 bg-amber-50 text-amber-950",
  immediate_attention: "border-red-500 bg-red-50 text-red-900",
};

function statusLabel(status: InspectionResultStatus | null) {
  if (status == null) return "Blank";
  return INSPECTION_RESULT_LABELS[status];
}

export function InspectionItemRow({
  workOrderId,
  result,
  readOnly,
  onRecommend,
}: {
  workOrderId: string;
  result: InspectionResultRow;
  readOnly: boolean;
  onRecommend?: (result: InspectionResultRow) => void;
}) {
  const [status, setStatus] = useState<InspectionResultStatus | null>(
    result.status
  );
  const [measurement, setMeasurement] = useState(result.measurement ?? "");
  const [notes, setNotes] = useState(result.notes ?? "");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const measurementRef = useRef(measurement);
  const notesRef = useRef(notes);

  useEffect(() => {
    setStatus(result.status);
    setMeasurement(result.measurement ?? "");
    setNotes(result.notes ?? "");
  }, [result.status, result.measurement, result.notes, result.updated_at]);

  useEffect(() => {
    measurementRef.current = measurement;
    notesRef.current = notes;
  }, [measurement, notes]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  function persist(input: {
    status?: InspectionResultStatus | null;
    measurement?: string | null;
    notes?: string | null;
  }) {
    setSaveState("saving");
    setError(null);
    startTransition(async () => {
      const response = await saveInspectionResultAction(
        workOrderId,
        result.inspection_result_id,
        input
      );
      if (!response.ok) {
        setSaveState("error");
        setError(response.error);
        return;
      }
      setSaveState("saved");
      window.setTimeout(() => setSaveState("idle"), 1200);
    });
  }

  function saveStatus(next: InspectionResultStatus | null) {
    setStatus(next);
    persist({ status: next });
  }

  function scheduleTextSave() {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      persist({
        measurement: measurementRef.current.trim() || null,
        notes: notesRef.current.trim() || null,
      });
    }, 400);
  }

  function flushTextSave() {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    persist({
      measurement: measurementRef.current.trim() || null,
      notes: notesRef.current.trim() || null,
    });
  }

  const needsAttention =
    status === "future_attention" || status === "immediate_attention";

  return (
    <article className="inspection-item-row rounded border border-zinc-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-zinc-900">
            {result.item_name_snapshot}
          </h3>
          <p className="mt-0.5 text-sm text-zinc-500">
            {result.category_snapshot}
            {result.requires_measurement_snapshot
              ? " · measurement required"
              : ""}
          </p>
        </div>
        <span
          className={`inspection-save-state text-xs font-medium ${
            saveState === "error"
              ? "text-red-700"
              : saveState === "saving"
                ? "text-zinc-500"
                : saveState === "saved"
                  ? "text-emerald-700"
                  : "text-transparent"
          }`}
          aria-live="polite"
        >
          {saveState === "saving"
            ? "Saving…"
            : saveState === "saved"
              ? "Saved"
              : saveState === "error"
                ? "Error"
                : "Idle"}
        </span>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {STATUS_OPTIONS.map((option) => {
          const key = String(option);
          const selected = status === option;
          return (
            <button
              key={key}
              type="button"
              disabled={readOnly}
              onClick={() => saveStatus(option)}
              className={`inspection-status-btn min-h-12 min-w-12 rounded border px-3 py-2 text-sm font-semibold disabled:opacity-50 ${
                selected
                  ? STATUS_BUTTON[key]
                  : "border-zinc-200 bg-zinc-50 text-zinc-600 hover:bg-zinc-100"
              }`}
            >
              {statusLabel(option)}
            </button>
          );
        })}
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {result.requires_measurement_snapshot || measurement ? (
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-zinc-800">
              Measurement
            </span>
            <input
              className="min-h-12 w-full rounded border border-zinc-300 bg-white px-3 py-2 text-base text-zinc-900 outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10 disabled:bg-zinc-50"
              value={measurement}
              disabled={readOnly}
              onChange={(e) => {
                setMeasurement(e.target.value);
                scheduleTextSave();
              }}
              onBlur={flushTextSave}
            />
          </label>
        ) : null}
        <label className="block sm:col-span-2">
          <span className="mb-1.5 block text-sm font-medium text-zinc-800">
            Notes
          </span>
          <textarea
            className="min-h-20 w-full rounded border border-zinc-300 bg-white px-3 py-2 text-base text-zinc-900 outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10 disabled:bg-zinc-50"
            rows={2}
            value={notes}
            disabled={readOnly}
            onChange={(e) => {
              setNotes(e.target.value);
              scheduleTextSave();
            }}
            onBlur={flushTextSave}
          />
        </label>
      </div>

      {error ? (
        <p role="alert" className="mt-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {!readOnly && needsAttention && onRecommend ? (
        <div className="mt-3">
          <button
            type="button"
            onClick={() => onRecommend(result)}
            className="btn btn-secondary min-h-12"
          >
            Create recommendation
          </button>
        </div>
      ) : null}
    </article>
  );
}
