"use client";

import { useActionState } from "react";
import { useRouter } from "next/navigation";
import {
  retryAssistantTurnAction,
  type AssistantActionState,
} from "@/app/(app)/work_orders/assistant-actions";
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

export function DiagnosticsThreadReadOnly({
  workspace,
}: {
  workspace: DiagnosticsThreadWorkspace;
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
          </article>
        ))}
      </div>

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
