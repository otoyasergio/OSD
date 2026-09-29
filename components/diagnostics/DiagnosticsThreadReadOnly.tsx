"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import {
  retryAssistantTurnAction,
  submitAssistantTurnAction,
  type AssistantActionState,
} from "@/app/(app)/work_orders/assistant-actions";
import { DiagnosticsPhotoPicker } from "@/components/diagnostics/DiagnosticsPhotoPicker";
import {
  buildPhotosPayload,
  photoPromptFromMessages,
  validatePhotoSelections,
  type DiagnosticsPhotoSelection,
  type DiagnosticsPhotoSourceRow,
} from "@/lib/diagnostics/photoSelection";
import { PHOTO_CATEGORY_LABELS } from "@/lib/status/labels";
import { DIAGNOSTICS_TURN_TEXT_MAX } from "@/lib/diagnostics/turnLimits";
import type { DiagnosticsThreadWorkspace } from "@/lib/services/diagnosticsAssistant";

const INITIAL_ACTION_STATE: AssistantActionState = {
  status: "idle",
  error: null,
};

function titleCase(value: string): string {
  return value
    .split("_")
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function TurnComposer({
  workspace,
  photos,
  canMutate,
  preview,
  readOnly,
}: {
  workspace: DiagnosticsThreadWorkspace;
  photos: DiagnosticsPhotoSourceRow[];
  canMutate: boolean;
  preview: boolean;
  readOnly: boolean;
}) {
  const router = useRouter();
  const { thread, messages } = workspace;
  const [text, setText] = useState("");
  const [selections, setSelections] = useState<DiagnosticsPhotoSelection[]>([]);
  const [uploading, setUploading] = useState(false);

  const [state, formAction, pending] = useActionState(
    async (previous: AssistantActionState, formData: FormData) => {
      const result = await submitAssistantTurnAction(
        thread.workOrderId,
        previous,
        formData
      );
      if (result.status === "success") {
        setText("");
        setSelections([]);
        router.refresh();
      }
      return result;
    },
    INITIAL_ACTION_STATE
  );

  const threadBusy = thread.status === "pending" || thread.status === "generating";
  const archived = thread.status === "archived";
  const blockedReason = preview
    ? "Role preview is read-only. Exit preview to send a message."
    : readOnly
      ? "This work order is read-only."
      : !canMutate
        ? "You can't send messages on this thread."
        : archived
          ? "This conversation is archived."
          : threadBusy
            ? "Ask OTOMOTO is still working on the previous message."
            : null;
  const locked = blockedReason !== null;
  const validation = validatePhotoSelections(selections);
  const trimmed = text.trim();
  const canSend =
    !locked &&
    !pending &&
    !uploading &&
    trimmed.length > 0 &&
    trimmed.length <= DIAGNOSTICS_TURN_TEXT_MAX &&
    validation.ok;
  const requestedPrompt = photoPromptFromMessages(messages);

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="thread_id" value={thread.threadId} />
      <input type="hidden" name="job_id" value={thread.jobId ?? ""} />
      <input type="hidden" name="mode" value={thread.mode} />
      <input
        type="hidden"
        name="photos"
        value={JSON.stringify(buildPhotosPayload(selections))}
      />

      <div className="flex flex-col gap-1">
        <label htmlFor={`turn-text-${thread.threadId}`} className="text-sm font-medium">
          Message to Ask OTOMOTO
        </label>
        <textarea
          id={`turn-text-${thread.threadId}`}
          name="text"
          className="input min-h-24"
          rows={4}
          maxLength={DIAGNOSTICS_TURN_TEXT_MAX}
          value={text}
          disabled={locked || pending}
          onChange={(event) => setText(event.target.value)}
        />
      </div>

      <DiagnosticsPhotoPicker
        thread={{
          threadId: thread.threadId,
          workOrderId: thread.workOrderId,
          jobId: thread.jobId,
        }}
        photos={photos}
        selections={selections}
        onSelectionsChange={setSelections}
        requestedPrompt={requestedPrompt}
        canMutate={canMutate}
        preview={preview}
        readOnly={readOnly}
        disabled={locked || pending}
        onBusyChange={setUploading}
      />

      {blockedReason ? (
        <p role="status" className="text-sm text-[var(--status-neutral)]">
          {blockedReason}
        </p>
      ) : null}
      {!validation.ok ? (
        <p role="alert" className="text-sm text-red-700">
          {validation.errors[0]}
        </p>
      ) : null}
      {state.error ? (
        <p role="alert" className="text-sm text-red-700">
          {state.error}
        </p>
      ) : null}

      <div>
        <button type="submit" className="btn btn-primary" disabled={!canSend}>
          {pending ? "Sending…" : "Send to Ask OTOMOTO"}
        </button>
      </div>
    </form>
  );
}

export function DiagnosticsThreadReadOnly({
  workspace,
  photos = [],
  canMutate = false,
  preview = false,
  readOnly = false,
}: {
  workspace: DiagnosticsThreadWorkspace;
  /** Authorized, already-filtered staff photos for this work order. */
  photos?: DiagnosticsPhotoSourceRow[];
  canMutate?: boolean;
  preview?: boolean;
  readOnly?: boolean;
}) {
  const router = useRouter();
  const { thread, messages } = workspace;
  const [retryState, retryAction, retryPending] = useActionState(
    retryAssistantTurnAction.bind(null, thread.workOrderId),
    INITIAL_ACTION_STATE
  );
  const automaticLabel =
    thread.triggerType === "inspection_completed"
      ? "Automatic arrival-inspection review"
      : thread.triggerType === "job_completed"
        ? "Automatic job-completion review"
        : null;

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-[var(--border)] bg-white p-4">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold">Ask OTOMOTO</h2>
          <p className="text-sm text-[var(--status-neutral)]">
            {titleCase(thread.mode)} · {titleCase(thread.status)}
          </p>
        </div>
        <span className="rounded-full bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-900">
          Staff review required
        </span>
      </header>

      {automaticLabel ? (
        <p className="text-xs font-medium text-[var(--status-neutral)]">
          {automaticLabel}
        </p>
      ) : null}

      {thread.status === "pending" || thread.status === "generating" ? (
        <p role="status" className="text-sm">
          {thread.status === "pending"
            ? "Pending automatic review."
            : "Generating automatic review."}
        </p>
      ) : null}
      {thread.status === "failed" ? (
        <p role="status" className="text-sm text-red-700">
          Generation failed. The completed inspection is unchanged.
        </p>
      ) : null}

      <div className="flex flex-col gap-2">
        {messages.map((message) => (
          <article
            key={message.messageId}
            className="rounded border border-[var(--border)] bg-[var(--surface-muted)] p-3"
          >
            <p className="mb-1 text-xs font-semibold uppercase text-[var(--status-neutral)]">
              {message.role === "assistant" ? "Ask OTOMOTO" : "Staff request"}
            </p>
            <div className="whitespace-pre-wrap text-sm">
              {message.body ??
                (message.generationStatus === "failed"
                  ? "Response unavailable — use Retry."
                  : "Response pending.")}
            </div>
            {message.photos.length > 0 ? (
              <ul
                aria-label="Attached photos"
                className="mt-2 flex flex-wrap gap-1 text-xs"
              >
                {message.photos.map((photo) => (
                  <li
                    key={photo.photoId}
                    className="rounded-full border border-[var(--border)] bg-white px-2 py-1"
                  >
                    {PHOTO_CATEGORY_LABELS[
                      photo.category as keyof typeof PHOTO_CATEGORY_LABELS
                    ] ?? "Photo"}{" "}
                    · {photo.purpose}
                  </li>
                ))}
              </ul>
            ) : null}
          </article>
        ))}
      </div>

      <TurnComposer
        key={thread.threadId}
        workspace={workspace}
        photos={photos}
        canMutate={canMutate}
        preview={preview}
        readOnly={readOnly}
      />

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => router.refresh()}
        >
          Refresh
        </button>
        {thread.status === "failed" ? (
          <form action={retryAction}>
            <input type="hidden" name="thread_id" value={thread.threadId} />
            <button type="submit" className="btn btn-primary" disabled={retryPending}>
              {retryPending ? "Retrying…" : "Retry"}
            </button>
          </form>
        ) : null}
      </div>
      {retryState.error ? (
        <p role="alert" className="text-sm text-red-700">
          {retryState.error}
        </p>
      ) : null}
    </section>
  );
}
