"use client";

import { useState, useTransition } from "react";
import { submitUxLogAction } from "@/app/(app)/ux-log-actions";

type Props = {
  message: string | null;
  /** Optional override for log source (defaults to current path). */
  source?: string;
  /** Optional machine code if known. */
  code?: string;
  workOrderId?: string;
};

/**
 * Shows a form/action error and lets any staff member submit it to the owner UX log.
 */
export function FormError({ message, source, code, workOrderId }: Props) {
  const [pending, startTransition] = useTransition();
  const [submittedFor, setSubmittedFor] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState("");
  const [noteFor, setNoteFor] = useState<string | null>(null);

  if (!message) return null;

  const submitted = submittedFor === message;
  const noteUiOpen = noteOpen && noteFor === message;

  function handleSubmit() {
    setSubmitError(null);
    const path =
      source ??
      (typeof window !== "undefined"
        ? `${window.location.pathname}${window.location.search}`
        : "unknown");

    startTransition(async () => {
      const result = await submitUxLogAction({
        message,
        source: path,
        note: noteFor === message ? note : "",
        code,
        workOrderId,
      });
      if (result.error) {
        setSubmitError(result.error);
        return;
      }
      setSubmittedFor(message);
      setNoteOpen(false);
    });
  }

  return (
    <div role="alert" className="alert-error flex flex-col gap-2">
      <p>{message}</p>
      {submitted ? (
        <p className="text-sm font-medium text-foreground">
          Log submitted — owners can review it under Settings → Logs.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {noteUiOpen ? (
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-foreground">
                What were you trying to do? (optional)
              </span>
              <textarea
                className="textarea"
                rows={2}
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Short note for the owner…"
                maxLength={500}
              />
            </label>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {!noteUiOpen ? (
              <button
                type="button"
                className="btn btn-secondary min-h-10 text-sm"
                onClick={() => {
                  setNoteFor(message);
                  setNoteOpen(true);
                  setNote("");
                  setSubmitError(null);
                }}
                disabled={pending}
              >
                Add note & submit log
              </button>
            ) : null}
            <button
              type="button"
              className="btn btn-primary min-h-10 text-sm"
              onClick={handleSubmit}
              disabled={pending}
            >
              {pending ? "Submitting…" : "Submit log"}
            </button>
          </div>
          {submitError ? (
            <p className="text-sm text-[var(--status-danger)]">{submitError}</p>
          ) : null}
        </div>
      )}
    </div>
  );
}
