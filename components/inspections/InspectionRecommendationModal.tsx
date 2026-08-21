"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import type {
  InspectionRecommendationDraftActionResult,
  RecommendationFormState,
} from "@/app/(app)/work_orders/recommendation-actions";
import {
  FormError,
  SELECT_CLASS,
  TextAreaField,
  TextField,
} from "@/components/forms/Field";
import { SubmitButton } from "@/components/forms/SubmitButton";
import type { InspectionResultRow } from "@/lib/services/inspections";
import { RECOMMENDATION_SEVERITY_LABELS } from "@/lib/status/labels";

type Action = (
  state: RecommendationFormState,
  formData: FormData
) => Promise<RecommendationFormState>;

type DraftLoader = () => Promise<InspectionRecommendationDraftActionResult>;

const DRAFT_LOAD_FALLBACK_ERROR =
  "Could not load this recommendation. Close and try again.";

const SEVERITIES = [
  "future_attention",
  "immediate_attention",
  "safety_critical",
] as const;

const FOCUSABLE_SELECTOR = [
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[href]:not([tabindex="-1"])',
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

export function InspectionRecommendationModal({
  result,
  loadDraft,
  action,
  onClose,
  onSaved,
}: {
  result: InspectionResultRow;
  loadDraft: DraftLoader;
  action: Action;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [state, formAction, pending] = useActionState(action, {
    error: null,
    saved: false,
  });
  const [draft, setDraft] =
    useState<InspectionRecommendationDraftActionResult["draft"]>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const restoreFocusToRef = useRef<Element | null>(null);

  useEffect(() => {
    let active = true;

    void loadDraft()
      .then((result) => {
        if (!active) return;
        setLoadError(result.error);
        setDraft(result.draft);
      })
      .catch(() => {
        if (!active) return;
        setDraft(null);
        setLoadError(DRAFT_LOAD_FALLBACK_ERROR);
      });

    return () => {
      active = false;
    };
  }, [loadDraft]);

  useEffect(() => {
    if (!state.saved) return;
    onSaved();
    onClose();
  }, [onClose, onSaved, state.saved]);

  useEffect(() => {
    restoreFocusToRef.current = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialogRef.current?.focus();

    return () => {
      document.body.style.overflow = previousOverflow;
      if (restoreFocusToRef.current instanceof HTMLElement) {
        restoreFocusToRef.current.focus();
      }
    };
  }, []);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !pending) {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key !== "Tab") return;
      const dialog = dialogRef.current;
      if (!dialog) return;

      const focusable = [
        ...dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      ].filter((element) => !element.matches(":disabled"));

      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose, pending]);

  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/55 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !pending) {
          onClose();
        }
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="inspection-recommendation-title"
        tabIndex={-1}
        className="w-full max-w-xl rounded-xl bg-white p-5 shadow-2xl"
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2
            id="inspection-recommendation-title"
            className="text-lg font-semibold text-foreground"
          >
            Recommendation
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="btn btn-secondary"
            aria-label="Close recommendation"
          >
            <X size={20} aria-hidden />
          </button>
        </div>

        {!draft && !loadError ? (
          <div className="py-6">
            <p role="status" className="text-sm text-[var(--status-neutral)]">
              Loading recommendation...
            </p>
          </div>
        ) : null}

        {loadError ? <FormError message={loadError} /> : null}

        {draft ? (
          <form
            key={`${result.inspection_result_id}:${draft.description}:${draft.severity}:${draft.notes}`}
            action={formAction}
          >
            <fieldset disabled={pending} className="flex min-w-0 flex-col gap-4">
              <FormError message={state.error} />
              <TextField
                label="Description"
                name="description"
                required
                defaultValue={draft.description}
              />
              <label className="block">
                <span className="mb-1.5 block text-sm font-medium text-foreground">
                  Severity <span className="text-red-600">*</span>
                </span>
                <select
                  name="severity"
                  required
                  defaultValue={draft.severity}
                  className={SELECT_CLASS}
                >
                  {SEVERITIES.map((severity) => (
                    <option key={severity} value={severity}>
                      {RECOMMENDATION_SEVERITY_LABELS[severity]}
                    </option>
                  ))}
                </select>
              </label>
              <TextAreaField
                label="Notes"
                name="notes"
                rows={3}
                defaultValue={draft.notes}
              />
              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={pending}
                  className="btn btn-secondary"
                >
                  Cancel
                </button>
                <SubmitButton label="Save recommendation" pendingLabel="Saving..." />
              </div>
            </fieldset>
          </form>
        ) : null}
      </div>
    </div>,
    document.body
  );
}
