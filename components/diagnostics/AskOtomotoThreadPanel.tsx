"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  retryAssistantTurnAction,
  submitAssistantTurnAction,
  type AssistantActionState,
} from "@/app/(app)/work_orders/assistant-actions";
import { DiagnosticsPhotoPicker } from "@/components/diagnostics/DiagnosticsPhotoPicker";
import {
  AskOtomotoMessage,
  RequestedInputCard,
} from "@/components/diagnostics/AskOtomotoMessage";
import { useAssistantPolling } from "@/components/diagnostics/useAssistantPolling";
import {
  buildPhotosPayload,
  photoRequestFromMessages,
  validatePhotoSelections,
  type DiagnosticsPhotoSelection,
  type DiagnosticsPhotoSourceRow,
} from "@/lib/diagnostics/photoSelection";
import { DIAGNOSTICS_TURN_TEXT_MAX } from "@/lib/diagnostics/turnLimits";
import {
  ASSISTANT_MODE_DESCRIPTIONS,
  ASSISTANT_MODE_LABELS,
  ASSISTANT_PHASE_LABELS,
  ASSISTANT_STATUS_LABELS,
  ASSISTANT_TRIGGER_LABELS,
  canPromoteAssistantMessage,
  isAssistantThreadWorking,
  parseRequestedInput,
  type AskOtomotoLockReason,
} from "@/lib/diagnostics/askOtomotoView";
import type { AskOtomotoConfigReason } from "@/lib/diagnostics/config";
import type { DiagnosticsThreadWorkspace } from "@/lib/services/diagnosticsAssistant";

const INITIAL_ACTION_STATE: AssistantActionState = {
  status: "idle",
  error: null,
};

export const ASSISTANT_NOT_CONFIGURED_COPY =
  "Ask OTOMOTO is not configured on this server, so new drafts can't be generated. An owner or manager needs to add the OpenAI API key to the server environment settings. Existing conversations stay readable and copyable.";

export const ASSISTANT_SETTINGS_INVALID_COPY =
  "Ask OTOMOTO settings on this server are invalid, so new drafts can't be generated. An owner or manager needs to correct the Ask OTOMOTO model, timeout, or output-limit setting. Existing conversations stay readable and copyable.";

export function assistantUnavailableCopy(reason: AskOtomotoConfigReason | null): string {
  return reason === null || reason === "not_configured"
    ? ASSISTANT_NOT_CONFIGURED_COPY
    : ASSISTANT_SETTINGS_INVALID_COPY;
}

function readOnlyReason(lockReason: AskOtomotoLockReason | null | undefined): string {
  if (lockReason === "foreign") {
    return "This work order belongs to another location. Switch location to make changes.";
  }
  if (lockReason === "locked") {
    return "This work order is completed or cancelled, so this conversation is read-only.";
  }
  return "This work order is read-only.";
}

function TurnComposer({
  workspace,
  photos,
  canMutate,
  preview,
  readOnly,
  lockReason,
  configured,
  retryPending,
  onBusyChange,
}: {
  workspace: DiagnosticsThreadWorkspace;
  photos: DiagnosticsPhotoSourceRow[];
  canMutate: boolean;
  preview: boolean;
  readOnly: boolean;
  lockReason: AskOtomotoLockReason | null;
  configured: boolean;
  retryPending: boolean;
  onBusyChange: (busy: boolean) => void;
}) {
  const router = useRouter();
  const { thread, messages } = workspace;
  const [text, setText] = useState("");
  const [selections, setSelections] = useState<DiagnosticsPhotoSelection[]>([]);
  const [uploading, setUploading] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const wasPending = useRef(false);

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

  const busy = pending || uploading;
  useEffect(() => {
    onBusyChange(busy);
  }, [busy, onBusyChange]);

  useEffect(() => {
    if (wasPending.current && !pending && state.status === "error") {
      textareaRef.current?.focus();
    }
    wasPending.current = pending;
  }, [pending, state]);

  // A brand-new manual thread starts "pending" with no messages and must accept
  // its first message; automatic triggers stay locked until generation finishes.
  const firstManualTurn =
    thread.status === "pending" && thread.triggerType === null && messages.length === 0;
  const threadBusy =
    thread.status === "generating" || (thread.status === "pending" && !firstManualTurn);
  const archived = thread.status === "archived";
  const blockedReason = preview
    ? "Role preview is read-only. Exit preview to send a message."
    : readOnly
      ? readOnlyReason(lockReason)
      : !canMutate
        ? "You can't send messages on this thread."
        : archived
          ? "This conversation is archived."
          : !configured
            ? "Sending is disabled until Ask OTOMOTO is configured."
            : threadBusy
              ? "Ask OTOMOTO is still working on the previous message."
              : retryPending
                ? "Retrying the failed response…"
                : null;
  const locked = blockedReason !== null;
  const validation = useMemo(() => validatePhotoSelections(selections), [selections]);
  const photosJson = useMemo(
    () => JSON.stringify(buildPhotosPayload(selections)),
    [selections]
  );
  const trimmed = text.trim();
  const canSend =
    !locked &&
    !pending &&
    !uploading &&
    trimmed.length > 0 &&
    trimmed.length <= DIAGNOSTICS_TURN_TEXT_MAX &&
    validation.ok;
  const request = useMemo(() => photoRequestFromMessages(messages), [messages]);

  return (
    <form
      action={formAction}
      onSubmit={(event) => {
        if (!canSend) event.preventDefault();
      }}
      className="flex flex-col gap-3"
    >
      <input type="hidden" name="thread_id" value={thread.threadId} />
      <input type="hidden" name="job_id" value={thread.jobId ?? ""} />
      <input type="hidden" name="mode" value={thread.mode} />
      <input type="hidden" name="photos" value={photosJson} />

      <div className="flex flex-col gap-1">
        <label htmlFor={`turn-text-${thread.threadId}`} className="text-sm font-medium">
          Message to Ask OTOMOTO
        </label>
        <textarea
          ref={textareaRef}
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
        requestedPrompt={request?.prompt ?? null}
        requestKey={request?.key ?? null}
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

export function AskOtomotoThreadPanel({
  workspace,
  photos = [],
  canMutate = false,
  preview = false,
  readOnly = false,
  lockReason = null,
  configured = true,
  canPromoteNotes = false,
  jobLabel = null,
}: {
  workspace: DiagnosticsThreadWorkspace;
  /** Authorized, already-filtered staff photos for this work order. */
  photos?: DiagnosticsPhotoSourceRow[];
  canMutate?: boolean;
  preview?: boolean;
  readOnly?: boolean;
  lockReason?: AskOtomotoLockReason | null;
  /** Server AI configuration present; history stays usable without it. */
  configured?: boolean;
  canPromoteNotes?: boolean;
  jobLabel?: string | null;
}) {
  const router = useRouter();
  const { thread, messages } = workspace;
  const [sendBusy, setSendBusy] = useState(false);
  const [retryState, retryAction, retryPending] = useActionState(
    async (previous: AssistantActionState, formData: FormData) => {
      const result = await retryAssistantTurnAction(
        thread.workOrderId,
        previous,
        formData
      );
      if (result.status === "success") router.refresh();
      return result;
    },
    INITIAL_ACTION_STATE
  );
  const mutationAllowed = canMutate && !readOnly && !preview;
  const retryAvailable = mutationAllowed && configured && thread.status === "failed";
  const canRetry = retryAvailable && !retryPending && !sendBusy;
  const automaticLabel = thread.triggerType
    ? ASSISTANT_TRIGGER_LABELS[thread.triggerType]
    : null;
  const frontOffice = thread.audience === "front_office";
  const promotable = mutationAllowed && canPromoteNotes;

  const working = isAssistantThreadWorking(workspace);
  const latest = messages[messages.length - 1];
  const pollKey = `${thread.threadId}:${thread.status}:${latest?.messageId ?? ""}:${
    latest?.generationStatus ?? ""
  }`;
  const { timedOut } = useAssistantPolling(working, pollKey, () => router.refresh());

  const requested =
    latest?.role === "assistant" && latest.generationStatus === "ready"
      ? parseRequestedInput(latest.requestedInput)
      : null;

  return (
    <section
      aria-label="Selected conversation"
      className="flex flex-col gap-3 rounded-lg border border-[var(--border)] bg-white p-4"
    >
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-base font-semibold">
            Ask OTOMOTO · {ASSISTANT_MODE_LABELS[thread.mode]}
          </h3>
          <p className="text-sm text-[var(--status-neutral)]">
            Mode: {ASSISTANT_MODE_LABELS[thread.mode]} · fixed for this conversation
          </p>
          <p className="text-sm text-[var(--status-neutral)]">
            {ASSISTANT_STATUS_LABELS[thread.status]}
            {thread.diagnosticPhase
              ? ` · ${ASSISTANT_PHASE_LABELS[thread.diagnosticPhase]}`
              : ""}
            {" · "}
            {thread.jobId ? `Job: ${jobLabel ?? "Selected job"}` : "Whole work order"}
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
      {thread.mode === "report" ? (
        <p className="text-xs text-[var(--status-neutral)]">
          {ASSISTANT_MODE_DESCRIPTIONS.report}
        </p>
      ) : null}
      {frontOffice ? (
        <p className="rounded border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2 text-sm">
          Copy only. Nothing is sent to the customer from here — review the draft and
          contact the customer yourself if appropriate.
        </p>
      ) : null}

      {thread.status === "generating" ? (
        <p role="status" className="text-sm">
          {automaticLabel ? "Generating automatic review." : "Generating response."}
        </p>
      ) : null}
      {thread.status === "pending" && thread.triggerType ? (
        <p role="status" className="text-sm">
          Pending automatic review.
        </p>
      ) : null}
      {timedOut ? (
        <p role="status" className="text-sm">
          Still working. Use Refresh to check again.
        </p>
      ) : null}
      {thread.status === "failed" ? (
        <p role="status" className="text-sm text-red-700">
          Generation failed. Work-order records were not changed.
        </p>
      ) : null}

      <div className="flex flex-col gap-2">
        {messages.map((message) => (
          <AskOtomotoMessage
            key={message.messageId}
            message={message}
            workOrderId={thread.workOrderId}
            jobId={thread.jobId}
            jobLabel={jobLabel}
            canPromote={canPromoteAssistantMessage({
              message,
              thread,
              canPromoteNotes: promotable,
            })}
            retryAvailable={retryAvailable}
            readOnlyView={preview || readOnly}
          />
        ))}
      </div>

      {requested ? <RequestedInputCard request={requested} /> : null}

      <TurnComposer
        key={thread.threadId}
        workspace={workspace}
        photos={photos}
        canMutate={canMutate}
        preview={preview}
        readOnly={readOnly}
        lockReason={lockReason}
        configured={configured}
        retryPending={retryPending}
        onBusyChange={setSendBusy}
      />

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => router.refresh()}
        >
          Refresh
        </button>
        {retryAvailable ? (
          <form
            action={retryAction}
            onSubmit={(event) => {
              if (!canRetry) event.preventDefault();
            }}
          >
            <input type="hidden" name="thread_id" value={thread.threadId} />
            <button type="submit" className="btn btn-primary" disabled={!canRetry}>
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
