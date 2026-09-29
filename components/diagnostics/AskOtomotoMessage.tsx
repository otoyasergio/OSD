"use client";

import { useRef, useState } from "react";
import { AssistantNoteReview } from "@/components/diagnostics/AssistantNoteReview";
import type { AskOtomotoRequestedInput } from "@/lib/diagnostics/askOtomotoView";
import { PHOTO_CATEGORY_LABELS } from "@/lib/status/labels";
import type { DiagnosticsMessageView } from "@/lib/services/diagnosticsAssistant";

export const AI_DRAFT_LABEL = "AI draft — staff review required";

function CopyDraftButton({ text }: { text: string }) {
  const [result, setResult] = useState<"idle" | "copied" | "failed">("idle");

  async function copy() {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("CLIPBOARD_UNAVAILABLE");
      await navigator.clipboard.writeText(text);
      setResult("copied");
    } catch {
      setResult("failed");
    }
  }

  return (
    <>
      <button type="button" className="btn btn-secondary" onClick={copy}>
        Copy AI draft
      </button>
      <span role="status" className="self-center text-xs text-[var(--status-neutral)]">
        {result === "copied" ? "Copied to clipboard." : ""}
      </span>
      {result === "failed" ? (
        <span role="alert" className="self-center text-xs text-red-700">
          Copy failed. Select the text and copy it manually.
        </span>
      ) : null}
    </>
  );
}

export function RequestedInputCard({ request }: { request: AskOtomotoRequestedInput }) {
  const rows: Array<[string, string | null]> = [
    ["Purpose", request.purpose],
    ["Placement", request.toolPlacement],
    ["Conditions", request.conditions],
    ["Units", request.units],
  ];
  return (
    <div
      role="region"
      aria-label="Next evidence requested"
      className="rounded border border-sky-300 bg-sky-50 p-3 text-sm text-sky-950"
    >
      <p className="text-xs font-semibold uppercase tracking-wide">
        Next evidence requested · {request.label}
      </p>
      <p className="mt-1 whitespace-pre-wrap font-medium">{request.prompt}</p>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        {rows
          .filter((row): row is [string, string] => row[1] !== null)
          .map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="font-medium">{label}</dt>
              <dd className="whitespace-pre-wrap">{value}</dd>
            </div>
          ))}
      </dl>
      <p className="mt-2 text-xs">
        Answer in the message box below. Ask OTOMOTO never runs a test or changes the work
        order.
      </p>
    </div>
  );
}

function unavailableText(
  message: DiagnosticsMessageView,
  retryAvailable: boolean,
  readOnlyView: boolean
): string {
  if (message.generationStatus === "policy_withheld") {
    return "Response withheld by the shop safety rules.";
  }
  if (message.generationStatus !== "failed") return "Response pending.";
  if (retryAvailable) return "Response unavailable — use Retry.";
  return readOnlyView
    ? "Response unavailable (read-only view)."
    : "Response unavailable.";
}

export function AskOtomotoMessage({
  message,
  workOrderId,
  jobId,
  jobLabel,
  canPromote,
  retryAvailable,
  readOnlyView,
}: {
  message: DiagnosticsMessageView;
  workOrderId: string;
  jobId: string | null;
  jobLabel: string | null;
  canPromote: boolean;
  retryAvailable: boolean;
  readOnlyView: boolean;
}) {
  const [review, setReview] = useState<"closed" | "open" | "saved">("closed");
  const reviewButtonRef = useRef<HTMLButtonElement>(null);
  const isAssistant = message.role === "assistant";
  const reviewId = `note-review-${message.messageId}`;

  function closeReview() {
    setReview("closed");
    reviewButtonRef.current?.focus();
  }

  return (
    <article className="rounded border border-[var(--border)] bg-[var(--surface-muted)] p-3">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase text-[var(--status-neutral)]">
          {isAssistant ? "Ask OTOMOTO" : "Staff request"}
        </p>
        {isAssistant ? (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900">
            {AI_DRAFT_LABEL}
          </span>
        ) : null}
      </div>
      <div className="whitespace-pre-wrap break-words text-sm">
        {message.body ?? unavailableText(message, retryAvailable, readOnlyView)}
      </div>
      {message.photos.length > 0 ? (
        <ul aria-label="Attached photos" className="mt-2 flex flex-wrap gap-1 text-xs">
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

      {isAssistant && message.body ? (
        <div className="mt-2 flex flex-wrap gap-2">
          <CopyDraftButton text={message.body} />
          {canPromote && review !== "saved" ? (
            <button
              ref={reviewButtonRef}
              type="button"
              className="btn btn-secondary"
              aria-expanded={review === "open"}
              aria-controls={review === "open" ? reviewId : undefined}
              onClick={() => (review === "open" ? closeReview() : setReview("open"))}
            >
              Review and save as note
            </button>
          ) : null}
        </div>
      ) : null}
      {review === "saved" ? (
        <p role="status" className="mt-2 text-sm font-medium text-emerald-800">
          Saved as a technician note. The AI draft is unchanged.
        </p>
      ) : null}
      {canPromote && review === "open" && message.body ? (
        <AssistantNoteReview
          id={reviewId}
          workOrderId={workOrderId}
          messageId={message.messageId}
          body={message.body}
          jobId={jobId}
          jobLabel={jobLabel}
          onCancel={closeReview}
          onSaved={() => setReview("saved")}
        />
      ) : null}
    </article>
  );
}
