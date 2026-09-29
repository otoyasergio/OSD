"use client";

import {
  startTransition,
  useActionState,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import {
  promoteAssistantNoteAction,
  type AssistantActionState,
} from "@/app/(app)/work_orders/assistant-actions";
import {
  ASSISTANT_NOTE_TEXT_MAX,
  PROMOTABLE_NOTE_TYPES,
  assistantDraftPlainText,
} from "@/lib/diagnostics/askOtomotoView";

const IDLE: AssistantActionState = { status: "idle", error: null };

/**
 * Staff-authored note seeded from an AI draft. The job is fixed by the thread
 * and the server refuses a second promotion of the same message.
 */
export function AssistantNoteReview({
  id,
  workOrderId,
  messageId,
  body,
  jobId,
  jobLabel,
  onCancel,
  onSaved,
}: {
  id: string;
  workOrderId: string;
  messageId: string;
  body: string;
  jobId: string | null;
  jobLabel: string | null;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const router = useRouter();
  const fieldId = useId();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [initialText] = useState(() => assistantDraftPlainText(body));
  const [text, setText] = useState(initialText);
  const [noteType, setNoteType] = useState<string>(PROMOTABLE_NOTE_TYPES[0].value);
  const [confirmed, setConfirmed] = useState(false);
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);
  const keepEditingRef = useRef<HTMLButtonElement>(null);
  const inFlight = useRef(false);
  const [state, dispatch, pending] = useActionState(
    async (previous: AssistantActionState, formData: FormData) => {
      try {
        const result = await promoteAssistantNoteAction(workOrderId, previous, formData);
        if (result.status === "success") {
          onSaved();
          router.refresh();
        }
        return result;
      } finally {
        inFlight.current = false;
      }
    },
    IDLE
  );

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  useEffect(() => {
    if (confirmingDiscard) keepEditingRef.current?.focus();
  }, [confirmingDiscard]);

  const dirty =
    text !== initialText || noteType !== PROMOTABLE_NOTE_TYPES[0].value || confirmed;

  function requestCancel() {
    if (pending) return;
    if (dirty) setConfirmingDiscard(true);
    else onCancel();
  }

  function keepEditing() {
    setConfirmingDiscard(false);
    textareaRef.current?.focus();
  }

  const trimmed = text.trim();
  const canSave =
    confirmed &&
    !pending &&
    trimmed.length > 0 &&
    trimmed.length <= ASSISTANT_NOTE_TEXT_MAX;

  return (
    <form
      id={id}
      aria-label="Review AI draft as note"
      // Dispatched manually so a failed save keeps the edited text and confirmation.
      onSubmit={(event) => {
        event.preventDefault();
        if (!canSave || inFlight.current) return;
        inFlight.current = true;
        const formData = new FormData(event.currentTarget);
        startTransition(() => dispatch(formData));
      }}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        // Escape also dismisses an IME candidate list; that must not close the review.
        if (event.nativeEvent.isComposing || event.keyCode === 229) return;
        event.preventDefault();
        if (confirmingDiscard) keepEditing();
        else requestCancel();
      }}
      className="mt-3 flex flex-col gap-3 rounded border border-[var(--border-strong)] bg-white p-3"
    >
      <input type="hidden" name="source_message_id" value={messageId} />
      <input type="hidden" name="job_id" value={jobId ?? ""} />

      <p className="text-sm font-semibold">Review before saving as a technician note</p>
      <p className="text-xs text-[var(--status-neutral)]">
        Edit the text so it states only what you verified. Saving creates a new note in
        your name; it never changes an existing note or the work order.
      </p>

      <div className="flex flex-col gap-1">
        <label htmlFor={`note-text-${fieldId}`} className="text-sm font-medium">
          Note text
        </label>
        <textarea
          ref={textareaRef}
          id={`note-text-${fieldId}`}
          name="text"
          className="input min-h-32"
          rows={6}
          maxLength={ASSISTANT_NOTE_TEXT_MAX}
          value={text}
          disabled={pending}
          onChange={(event) => setText(event.target.value)}
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor={`note-type-${fieldId}`} className="text-sm font-medium">
          Note type
        </label>
        <select
          id={`note-type-${fieldId}`}
          name="note_type"
          className="select"
          value={noteType}
          disabled={pending}
          onChange={(event) => setNoteType(event.target.value)}
        >
          {PROMOTABLE_NOTE_TYPES.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <p className="text-sm">
        <span className="font-medium">Saved to: </span>
        {jobId
          ? `${jobLabel ?? "Selected job"} (fixed by this conversation)`
          : "Whole work order"}
      </p>

      <label className="flex min-h-11 items-start gap-2 text-sm">
        <input
          type="checkbox"
          className="mt-1 h-5 w-5"
          checked={confirmed}
          disabled={pending}
          onChange={(event) => setConfirmed(event.target.checked)}
        />
        <span>I reviewed and edited this draft and want to save it as my own note.</span>
      </label>

      {state.error ? (
        <p role="alert" className="text-sm text-red-700">
          {state.error}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <button type="submit" className="btn btn-primary" disabled={!canSave}>
          {pending ? "Saving…" : "Save note"}
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={pending}
          onClick={requestCancel}
        >
          Cancel
        </button>
      </div>

      {confirmingDiscard ? (
        <div className="flex flex-col gap-2 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
          <p id={`note-discard-${fieldId}`}>
            Discard your changes to this note? Nothing has been saved.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              ref={keepEditingRef}
              type="button"
              className="btn btn-primary"
              aria-describedby={`note-discard-${fieldId}`}
              onClick={keepEditing}
            >
              Keep editing
            </button>
            <button type="button" className="btn btn-secondary" onClick={onCancel}>
              Discard changes
            </button>
          </div>
        </div>
      ) : null}
    </form>
  );
}
