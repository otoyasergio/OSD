"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import type { InspectionResultRow } from "@/lib/services/inspections";
import type { InspectionResultStatus } from "@/lib/database/types";
import { saveInspectionResultAction } from "@/app/(app)/work_orders/[work_order_id]/inspection/actions";
import { InspectionPhotoSlot } from "@/components/inspections/InspectionPhotoSlot";
import { BRAKE_INSPECTION_SKIP_ITEM } from "@/lib/services/inspectionGate";

type SaveState = "idle" | "saving" | "saved" | "error";

const STATUS_OPTIONS: Array<{
  value: InspectionResultStatus;
  short: string;
  className: string;
}> = [
  { value: "ok", short: "OK", className: "inspection-status-ok" },
  {
    value: "future_attention",
    short: "Future",
    className: "inspection-status-future",
  },
  {
    value: "immediate_attention",
    short: "Now",
    className: "inspection-status-immediate",
  },
];

function measurementHint(itemName: string): string | null {
  if (/brake lining/i.test(itemName)) return "mm";
  if (/tire tread/i.test(itemName)) return "32nds";
  if (/tire pressure/i.test(itemName)) return "PSI";
  if (/cold cranking/i.test(itemName)) return "CCA";
  return null;
}

function displayName(itemName: string): string {
  return itemName
    .replace(/^Front\s+/i, "")
    .replace(/^Rear\s+/i, "")
    .replace(/\s*\([^)]*\)\s*$/, "")
    .trim();
}

export function InspectionItemRow({
  workOrderId,
  result,
  readOnly,
  photoUrl,
  photoRequired,
  onRecommend,
  compact,
}: {
  workOrderId: string;
  result: InspectionResultRow;
  readOnly: boolean;
  photoUrl?: string | null;
  photoRequired?: boolean;
  onRecommend?: (result: InspectionResultRow) => void;
  compact?: boolean;
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
    const value = status === next ? null : next;
    setStatus(value);
    persist({ status: value });
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
  const unit = measurementHint(result.item_name_snapshot);
  const isSkip = result.item_name_snapshot === BRAKE_INSPECTION_SKIP_ITEM;
  const showMeasurement =
    result.requires_measurement_snapshot || Boolean(measurement) || Boolean(unit);

  return (
    <article
      className={`inspection-item-row ${compact ? "inspection-item-row--compact" : ""} ${
        isSkip ? "inspection-item-row--skip" : ""
      } ${needsAttention ? "inspection-item-row--flagged" : ""}`}
    >
      <div className="inspection-item-main">
        <div className="inspection-item-title-row">
          <h3 className="inspection-item-title">
            {isSkip ? result.item_name_snapshot : displayName(result.item_name_snapshot)}
          </h3>
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

        <div className="inspection-status-group" role="group" aria-label="Status">
          {STATUS_OPTIONS.map((option) => {
            const selected = status === option.value;
            return (
              <button
                key={option.value}
                type="button"
                disabled={readOnly}
                onClick={() => saveStatus(option.value)}
                className={`inspection-status-swatch ${option.className} ${
                  selected ? "is-selected" : ""
                }`}
                aria-pressed={selected}
                title={option.short}
              >
                <span className="sr-only">{option.short}</span>
              </button>
            );
          })}
        </div>
      </div>

      {showMeasurement ? (
        <label className="inspection-measurement">
          <span className="inspection-measurement-label">
            {unit ? `Measurement (${unit})` : "Measurement"}
          </span>
          <input
            className="inspection-measurement-input"
            value={measurement}
            disabled={readOnly}
            inputMode="decimal"
            placeholder={unit ?? ""}
            onChange={(e) => {
              setMeasurement(e.target.value);
              scheduleTextSave();
            }}
            onBlur={flushTextSave}
          />
        </label>
      ) : null}

      {!compact || notes || needsAttention || isSkip ? (
        <label className="inspection-notes">
          <span className="sr-only">Notes</span>
          <textarea
            className="inspection-notes-input"
            rows={compact ? 1 : 2}
            value={notes}
            disabled={readOnly}
            placeholder={
              isSkip
                ? "Optional note"
                : needsAttention
                  ? "Describe the issue…"
                  : "Notes"
            }
            onChange={(e) => {
              setNotes(e.target.value);
              scheduleTextSave();
            }}
            onBlur={flushTextSave}
          />
        </label>
      ) : null}

      {error ? (
        <p role="alert" className="mt-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {needsAttention ? (
        <div className="inspection-item-photo">
          <InspectionPhotoSlot
            workOrderId={workOrderId}
            category="inspection_item"
            inspectionResultId={result.inspection_result_id}
            label={`Photo for ${displayName(result.item_name_snapshot)}`}
            required={photoRequired !== false}
            existingUrl={photoUrl}
            readOnly={readOnly}
          />
          {!readOnly && onRecommend ? (
            <button
              type="button"
              onClick={() => onRecommend(result)}
              className="btn btn-secondary min-h-12"
            >
              Create recommendation
            </button>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
