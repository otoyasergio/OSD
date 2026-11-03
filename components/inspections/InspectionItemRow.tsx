"use client";

import { useEffect, useRef, useState } from "react";
import type { InspectionResultRow } from "@/lib/services/inspections";
import { Check, Clock, AlertTriangle, Minus } from "lucide-react";
import type { InspectionResultStatus } from "@/lib/database/types";
import { saveInspectionResultAction } from "@/app/(app)/work_orders/[work_order_id]/inspection/actions";
import { InspectionPhotoSlot } from "@/components/inspections/InspectionPhotoSlot";
import {
  BRAKE_INSPECTION_SKIP_ITEM,
  isSubstantiveNote,
  measurementIsRecorded,
} from "@/lib/services/inspectionGate";
import { describeInspectionSaveFailure } from "@/lib/inspections/inspectionSaveFailure";
import {
  shouldApplyServerInspectionText,
  textSaveStillMatchesLocal,
} from "@/lib/inspections/inspectionItemTextSync";

type SaveState = "idle" | "saving" | "saved" | "error";

const STATUS_OPTIONS: Array<{
  value: InspectionResultStatus;
  short: string;
  long: string;
  className: string;
  Icon: typeof Check;
}> = [
  {
    value: "ok",
    short: "OK",
    long: "Checked and OK",
    className: "inspection-status-ok",
    Icon: Check,
  },
  {
    value: "future_attention",
    short: "Future",
    long: "May need future attention",
    className: "inspection-status-future",
    Icon: Clock,
  },
  {
    value: "immediate_attention",
    short: "Now",
    long: "Requires immediate attention",
    className: "inspection-status-immediate",
    Icon: AlertTriangle,
  },
  {
    value: "not_applicable",
    short: "N/A",
    long: "Not applicable",
    className: "inspection-status-na",
    Icon: Minus,
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
  photoUrls,
  inlinePhoto,
  evidenceCallout,
  incomplete,
  onExpandPhoto,
  onRecommend,
  onBusyChange,
  onLocalStatusChange,
  onLocalDraftChange,
  onRegisterFlush,
  compact,
}: {
  workOrderId: string;
  result: InspectionResultRow;
  readOnly: boolean;
  photoUrls?: string[];
  /** Photo captured on this row. Grid evidence photos use evidenceCallout instead. */
  inlinePhoto?: { label: string; detail?: string; required: boolean } | null;
  evidenceCallout?: { label: string; href: string; missing: boolean } | null;
  incomplete?: boolean;
  onExpandPhoto?: (src: string) => void;
  onRecommend?: (result: InspectionResultRow) => void;
  onBusyChange?: (resultId: string, busy: boolean) => void;
  onLocalStatusChange?: (resultId: string, status: InspectionResultStatus | null) => void;
  onLocalDraftChange?: (
    resultId: string,
    draft: { notes: string; measurement: string }
  ) => void;
  onRegisterFlush?: (
    resultId: string,
    flush: (() => Promise<"clean" | "saved" | "failed">) | null
  ) => void;
  compact?: boolean;
}) {
  const [status, setStatus] = useState<InspectionResultStatus | null>(result.status);
  const [measurement, setMeasurement] = useState(result.measurement ?? "");
  const [notes, setNotes] = useState(result.notes ?? "");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [textDirty, setTextDirty] = useState(false);
  const [textFocused, setTextFocused] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const textDirtyRef = useRef(false);
  const inflightRef = useRef<Promise<void> | null>(null);
  const flushForFinishRef = useRef<(() => Promise<"clean" | "saved" | "failed">) | null>(
    null
  );
  const measurementRef = useRef(measurement);
  const notesRef = useRef(notes);
  const statusBeforeSaveRef = useRef<InspectionResultStatus | null>(result.status);
  const saveSeqRef = useRef(0);

  // Re-sync local edits when the server row changes (adjust-state-during-render
  // pattern, https://react.dev/learn/you-might-not-need-an-effect).
  // Never overwrite note/measurement drafts while the tech is still typing —
  // autosave revalidatePath can return props older than the local draft.
  const [prevResult, setPrevResult] = useState(result);
  if (
    prevResult.status !== result.status ||
    prevResult.measurement !== result.measurement ||
    prevResult.notes !== result.notes ||
    prevResult.updated_at !== result.updated_at
  ) {
    setPrevResult(result);
    setStatus(result.status);
    if (
      shouldApplyServerInspectionText({
        focused: textFocused,
        dirty: textDirty,
      })
    ) {
      setMeasurement(result.measurement ?? "");
      setNotes(result.notes ?? "");
    }
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

  useEffect(() => {
    const resultId = result.inspection_result_id;
    onRegisterFlush?.(
      resultId,
      () => flushForFinishRef.current?.() ?? Promise.resolve("clean")
    );
    return () => onRegisterFlush?.(resultId, null);
  }, [onRegisterFlush, result.inspection_result_id]);

  function persist(input: {
    status?: InspectionResultStatus | null;
    measurement?: string | null;
    notes?: string | null;
  }): Promise<"saved" | "failed" | "superseded"> {
    const resultId = result.inspection_result_id;
    const seq = ++saveSeqRef.current;
    setSaveState("saving");
    onBusyChange?.(resultId, true);
    setError(null);
    const task = (async (): Promise<"saved" | "failed" | "superseded"> => {
      let response: Awaited<ReturnType<typeof saveInspectionResultAction>>;
      try {
        response = await saveInspectionResultAction(workOrderId, resultId, input);
      } catch (error) {
        if (seq !== saveSeqRef.current) return "superseded";
        // A thrown action did not write. Keep the draft on screen.
        setSaveState("error");
        setError(describeInspectionSaveFailure(error));
        onBusyChange?.(resultId, false);
        return "failed";
      }
      if (seq !== saveSeqRef.current) {
        // A newer save superseded this one; leave UI to the latest request.
        return "superseded";
      }
      if (!response.ok) {
        if ("status" in input) {
          const reverted = statusBeforeSaveRef.current;
          setStatus(reverted);
          onLocalStatusChange?.(resultId, reverted);
        }
        setSaveState("error");
        setError(response.error);
        onBusyChange?.(resultId, false);
        return "failed";
      }
      if ("status" in input) {
        statusBeforeSaveRef.current = input.status ?? null;
      }
      if (
        ("notes" in input || "measurement" in input) &&
        textSaveStillMatchesLocal({
          localNotes: notesRef.current,
          localMeasurement: measurementRef.current,
          savedNotes: input.notes,
          savedMeasurement: input.measurement,
        })
      ) {
        textDirtyRef.current = false;
        setTextDirty(false);
      }
      setSaveState("saved");
      onBusyChange?.(resultId, false);
      window.setTimeout(() => {
        if (seq === saveSeqRef.current) setSaveState("idle");
      }, 1200);
      return "saved";
    })();
    const settled = task.then(
      () => undefined,
      () => undefined
    );
    inflightRef.current = settled;
    void settled.finally(() => {
      if (inflightRef.current === settled) inflightRef.current = null;
    });
    return task;
  }

  function saveStatus(next: InspectionResultStatus | null) {
    const value = status === next ? null : next;
    statusBeforeSaveRef.current = status;
    setStatus(value);
    onLocalStatusChange?.(result.inspection_result_id, value);
    // Include current text so a status-only save + revalidate cannot wipe an
    // unsaved note/measurement draft from the database snapshot.
    persist({
      status: value,
      measurement: measurementRef.current.trim() || null,
      notes: notesRef.current.trim() || null,
    });
  }

  function scheduleTextSave() {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      void persist({
        measurement: measurementRef.current.trim() || null,
        notes: notesRef.current.trim() || null,
      });
    }, 700);
  }

  function flushTextSave() {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = null;
    void persist({
      measurement: measurementRef.current.trim() || null,
      notes: notesRef.current.trim() || null,
    });
  }

  async function flushForFinish(): Promise<"clean" | "saved" | "failed"> {
    let pendingDebounce = debounceRef.current != null;
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    let saved = false;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      if (pendingDebounce || textDirtyRef.current) {
        pendingDebounce = false;
        const outcome = await persist({
          measurement: measurementRef.current.trim() || null,
          notes: notesRef.current.trim() || null,
        });
        if (outcome === "failed") return "failed";
        if (outcome === "saved") saved = true;
        continue;
      }
      if (inflightRef.current) {
        await inflightRef.current;
        continue;
      }
      return saved ? "saved" : "clean";
    }
    return textDirtyRef.current ? "failed" : saved ? "saved" : "clean";
  }

  useEffect(() => {
    flushForFinishRef.current = flushForFinish;
  });

  function onTextFocus() {
    setTextFocused(true);
  }

  function onTextBlur() {
    setTextFocused(false);
    flushTextSave();
  }

  const needsAttention =
    status === "future_attention" || status === "immediate_attention";
  const unit = measurementHint(result.item_name_snapshot);
  const isSkip = result.item_name_snapshot === BRAKE_INSPECTION_SKIP_ITEM;
  const isAcknowledgment = /acknowledgment/i.test(result.item_name_snapshot);
  const showMeasurement =
    !isSkip &&
    (result.requires_measurement_snapshot || Boolean(measurement) || Boolean(unit));
  const measurementRequired =
    Boolean(result.requires_measurement_snapshot) &&
    status != null &&
    status !== "not_applicable" &&
    !isSkip;
  const measurementMissing = measurementRequired && !measurementIsRecorded(measurement);
  const notesRequired =
    needsAttention ||
    status === "not_applicable" ||
    (isSkip && status === "ok") ||
    (isAcknowledgment && status != null);
  const notesMissing = notesRequired && !isSubstantiveNote(notes);
  const selectedOption = STATUS_OPTIONS.find((o) => o.value === status);
  const primaryStatuses = STATUS_OPTIONS.filter(
    (option) => option.value !== "not_applicable"
  );
  const attentionClass =
    status === "immediate_attention"
      ? "inspection-item-row--immediate"
      : status === "future_attention"
        ? "inspection-item-row--flagged"
        : incomplete
          ? "inspection-item-row--incomplete"
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
                  : `inspection-status-chip--${
                      selectedOption.value === "not_applicable"
                        ? "na"
                        : selectedOption.value
                    }`
                : "inspection-status-chip--none"
            }`}
          >
            {selectedOption
              ? isSkip
                ? "Not performed this visit"
                : selectedOption.long
              : "Not checked"}
          </span>
        ) : isSkip ? (
          <button
            type="button"
            onClick={() => saveStatus("ok")}
            className={`inspection-skip-toggle ${status === "ok" ? "is-selected" : ""}`}
            aria-pressed={status === "ok"}
          >
            Not inspected this visit
          </button>
        ) : (
          <div className="inspection-status-group" role="group" aria-label="Status">
            {primaryStatuses.map((option) => {
              const selected = status === option.value;
              const Icon = option.Icon;
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
                  <Icon className="inspection-status-swatch-icon" aria-hidden size={18} />
                  <span className="inspection-status-swatch-label" aria-hidden>
                    {option.short}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
      {!readOnly && !isSkip ? (
        <button
          type="button"
          onClick={() => saveStatus("not_applicable")}
          className={`inspection-na-toggle ${
            status === "not_applicable" ? "is-selected" : ""
          }`}
          aria-pressed={status === "not_applicable"}
        >
          Does not apply to this bike
        </button>
      ) : null}
      {!readOnly && isSkip ? (
        <p className="inspection-skip-note">
          Only when this visit is not a brake and tire inspection. A real reason is
          required. Tire and brake photos stay required until that reason is saved.
        </p>
      ) : null}

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
                {measurementRequired ? (
                  <span className="inspection-notes-required">Required</span>
                ) : null}
              </span>
              <input
                className={`inspection-measurement-input ${
                  measurementMissing ? "is-missing" : ""
                }`}
                value={measurement}
                inputMode="decimal"
                placeholder={unit ?? "Number"}
                aria-required={measurementRequired || undefined}
                aria-invalid={measurementMissing || undefined}
                onChange={(e) => {
                  const next = e.target.value;
                  textDirtyRef.current = true;
                  setTextDirty(true);
                  setMeasurement(next);
                  onLocalDraftChange?.(result.inspection_result_id, {
                    notes: notesRef.current,
                    measurement: next,
                  });
                  scheduleTextSave();
                }}
                onFocus={onTextFocus}
                onBlur={onTextBlur}
              />
            </label>
          ) : null}

          {!compact || notes || notesRequired ? (
            <label className="inspection-notes">
              <span className={notesRequired ? "inspection-notes-label" : "sr-only"}>
                {isSkip
                  ? "Why not this visit"
                  : status === "not_applicable"
                    ? "Why it doesn't apply"
                    : needsAttention
                      ? "Describe the issue"
                      : isAcknowledgment
                        ? "Acknowledgment"
                        : "Notes"}
                {notesRequired ? (
                  <span className="inspection-notes-required">Required</span>
                ) : null}
              </span>
              <textarea
                className={`inspection-notes-input ${notesMissing ? "is-missing" : ""}`}
                rows={notesRequired ? 2 : compact ? 1 : 2}
                value={notes}
                aria-required={notesRequired || undefined}
                aria-invalid={notesMissing || undefined}
                placeholder={
                  isSkip
                    ? "Why aren't brakes and tires being inspected this visit?"
                    : status === "not_applicable"
                      ? "Why doesn't this apply? For example: shaft drive, no center stand."
                      : needsAttention
                        ? "Describe what you found…"
                        : isAcknowledgment
                          ? "Who acknowledged this, and how?"
                          : "Notes"
                }
                onChange={(e) => {
                  const next = e.target.value;
                  textDirtyRef.current = true;
                  setTextDirty(true);
                  setNotes(next);
                  onLocalDraftChange?.(result.inspection_result_id, {
                    notes: next,
                    measurement: measurementRef.current,
                  });
                  scheduleTextSave();
                }}
                onFocus={onTextFocus}
                onBlur={onTextBlur}
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

      {evidenceCallout ? (
        <p
          className={`inspection-evidence-callout ${
            evidenceCallout.missing ? "is-missing" : ""
          }`}
        >
          <a href={evidenceCallout.href}>{evidenceCallout.label}</a>
          {evidenceCallout.missing
            ? " is required in Evidence photos."
            : " is on the report."}
        </p>
      ) : null}

      {inlinePhoto && (!readOnly || (photoUrls && photoUrls.length > 0)) ? (
        <div className="inspection-item-photo">
          <InspectionPhotoSlot
            id={`inspection-evidence-${result.inspection_result_id}`}
            workOrderId={workOrderId}
            category="inspection_item"
            inspectionResultId={result.inspection_result_id}
            label={inlinePhoto.label}
            detail={inlinePhoto.detail}
            required={inlinePhoto.required}
            existingUrls={photoUrls}
            readOnly={readOnly}
            onExpand={onExpandPhoto}
          />
          {!readOnly && needsAttention && onRecommend ? (
            <button
              type="button"
              onClick={() => onRecommend(result)}
              className="btn btn-secondary min-h-12"
            >
              Create recommendation
            </button>
          ) : null}
        </div>
      ) : !readOnly && needsAttention && onRecommend ? (
        <div className="inspection-item-photo">
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
