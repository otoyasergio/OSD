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
  long: string;
  className: string;
}> = [
  {
    value: "ok",
    short: "OK",
    long: "Checked and OK",
    className: "inspection-status-ok",
  },
  {
    value: "future_attention",
    short: "Future",
    long: "May need future attention",
    className: "inspection-status-future",
  },
  {
    value: "immediate_attention",
    short: "Now",
    long: "Requires immediate attention",
    className: "inspection-status-immediate",
  },
  {
    value: "not_applicable",
    short: "N/A",
    long: "Not applicable",
    className: "inspection-status-na",
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
  const cleaned = itemName
    .replace(/^Front\s+/i, "")
    .replace(/^Rear\s+/i, "")
    .replace(/\s*\([^)]*\)\s*$/, "")
    .trim();
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

export function InspectionItemRow({
  workOrderId,
  result,
  readOnly,
  photoUrl,
  photoRequired,
  compact,
}: {
  workOrderId: string;
  result: InspectionResultRow;
  readOnly: boolean;
  photoUrl?: string | null;
  photoRequired?: boolean;
  compact?: boolean;
}) {
  const [status, setStatus] = useState<InspectionResultStatus | null>(result.status);
  const [measurement, setMeasurement] = useState(result.measurement ?? "");
  const [notes, setNotes] = useState(result.notes ?? "");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [hasRecommendation, setHasRecommendation] = useState(
    Boolean(result.recommendation_id)
  );
  const [, startTransition] = useTransition();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const measurementRef = useRef(measurement);
  const notesRef = useRef(notes);

  // Re-sync local edits when the server row changes (adjust-state-during-render
  // pattern, https://react.dev/learn/you-might-not-need-an-effect).
  const [prevResult, setPrevResult] = useState(result);
  if (
    prevResult.status !== result.status ||
    prevResult.measurement !== result.measurement ||
    prevResult.notes !== result.notes ||
    prevResult.updated_at !== result.updated_at ||
    prevResult.recommendation_id !== result.recommendation_id
  ) {
    setPrevResult(result);
    setStatus(result.status);
    setMeasurement(result.measurement ?? "");
    setNotes(result.notes ?? "");
    setHasRecommendation(Boolean(result.recommendation_id));
  }

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
      if (
        input.status === "future_attention" ||
        input.status === "immediate_attention"
      ) {
        setHasRecommendation(true);
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
  const selectedOption = STATUS_OPTIONS.find((o) => o.value === status);
  const attentionClass =
    status === "immediate_attention"
      ? "inspection-item-row--immediate"
      : status === "future_attention"
        ? "inspection-item-row--flagged"
        : "";

  return (
    <article
      className={`inspection-item-row ${compact ? "inspection-item-row--compact" : ""} ${
        isSkip ? "inspection-item-row--skip" : ""
      } ${attentionClass}`}
    >
      <div className="inspection-item-main">
        <div className="inspection-item-title-row">
          <h3 className="inspection-item-title">
            {isSkip ? result.item_name_snapshot : displayName(result.item_name_snapshot)}
          </h3>
          {!readOnly ? (
            <span
              className={`inspection-save-state text-xs font-medium ${
                saveState === "error"
                  ? "text-red-700"
                  : saveState === "saving"
                    ? "text-[var(--status-neutral)]"
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
          ) : null}
        </div>

        {readOnly ? (
          <span
            className={`inspection-status-chip ${
              selectedOption
                ? isSkip
                  ? "inspection-status-chip--skip"
                  : `inspection-status-chip--${selectedOption.value}`
                : "inspection-status-chip--none"
            }`}
          >
            {selectedOption
              ? isSkip
                ? "Not performed this visit"
                : selectedOption.long
              : "Not checked"}
          </span>
        ) : (
          <div className="inspection-status-group" role="group" aria-label="Status">
            {STATUS_OPTIONS.map((option) => {
              const selected = status === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => saveStatus(option.value)}
                  className={`inspection-status-swatch ${option.className} ${
                    selected ? "is-selected" : ""
                  }`}
                  aria-pressed={selected}
                  aria-label={option.long}
                  title={option.long}
                >
                  <span className="inspection-status-swatch-label" aria-hidden>
                    {option.short}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {readOnly ? (
        <>
          {measurement ? (
            <p className="inspection-readonly-line">
              <span className="inspection-readonly-label">
                {unit ? `Measurement (${unit})` : "Measurement"}
              </span>
              <span className="inspection-readonly-value">{measurement}</span>
            </p>
          ) : null}
          {notes ? (
            <p className="inspection-readonly-line">
              <span className="inspection-readonly-label">Notes</span>
              <span className="inspection-readonly-value">{notes}</span>
            </p>
          ) : null}
        </>
      ) : (
        <>
          {showMeasurement ? (
            <label className="inspection-measurement">
              <span className="inspection-measurement-label">
                {unit ? `Measurement (${unit})` : "Measurement"}
              </span>
              <input
                className="inspection-measurement-input"
                value={measurement}
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
        </>
      )}

      {error ? (
        <p role="alert" className="mt-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {needsAttention && (!readOnly || photoUrl) ? (
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
          {hasRecommendation || result.recommendation_id ? (
            <p className="text-sm font-medium text-emerald-800">
              Recommendation created
            </p>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
