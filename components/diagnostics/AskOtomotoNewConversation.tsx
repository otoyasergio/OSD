"use client";

import { startTransition, useActionState, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  createAssistantThreadAction,
  type AssistantActionState,
} from "@/app/(app)/work_orders/assistant-actions";
import {
  ASSISTANT_MODE_DESCRIPTIONS,
  ASSISTANT_MODE_LABELS,
  askOtomotoThreadHref,
  assistantModeOptions,
  parseCreatedThread,
  type AskOtomotoCapabilities,
  type AskOtomotoJobOption,
  type AskOtomotoRoute,
} from "@/lib/diagnostics/askOtomotoView";
import type { AiAssistantMode } from "@/lib/database/types";

const IDLE: AssistantActionState = { status: "idle", error: null };

function createBlockedReason(
  capabilities: AskOtomotoCapabilities,
  configured: boolean
): string | null {
  if (!capabilities.canMutate) {
    switch (capabilities.lockReason) {
      case "preview":
        return "Role preview is read-only. Exit preview to start a conversation.";
      case "foreign":
        return "This work order belongs to another location. Switch location to start a conversation.";
      case "locked":
        return "This work order is completed or cancelled. Ask OTOMOTO history is read-only.";
      default:
        return "Your role can read Ask OTOMOTO history but cannot start conversations.";
    }
  }
  if (!configured) {
    return "Starting a conversation is disabled until Ask OTOMOTO is configured.";
  }
  return null;
}

export function AskOtomotoNewConversation({
  route,
  jobs,
  defaultJobId,
  capabilities,
  configured,
}: {
  route: AskOtomotoRoute;
  jobs: AskOtomotoJobOption[];
  defaultJobId: string | null;
  capabilities: AskOtomotoCapabilities;
  configured: boolean;
}) {
  const router = useRouter();
  const idBase = useId();
  const modes = assistantModeOptions({
    surface: route.surface,
    canUseFrontOfficeModes: capabilities.canUseFrontOfficeModes,
  });
  const [mode, setMode] = useState<AiAssistantMode>(modes[0]);
  const selectedMode = modes.includes(mode) ? mode : modes[0];
  const [jobId, setJobId] = useState(defaultJobId ?? "");
  const fixedJob = route.surface === "floor";
  const floorJob = fixedJob
    ? (jobs.find((job) => job.jobId === defaultJobId) ?? null)
    : null;

  const inFlight = useRef(false);
  const [state, dispatch, pending] = useActionState(
    async (previous: AssistantActionState, formData: FormData) => {
      try {
        const result = await createAssistantThreadAction(
          route.workOrderId,
          previous,
          formData
        );
        if (result.status !== "success") return result;
        const created = parseCreatedThread(result.data, route.workOrderId);
        if (!created) {
          return {
            status: "error" as const,
            error:
              "Ask OTOMOTO could not open the new conversation. Refresh and try again.",
          };
        }
        router.push(askOtomotoThreadHref(route, created.threadId));
        return IDLE;
      } finally {
        inFlight.current = false;
      }
    },
    IDLE
  );

  const blockedReason = createBlockedReason(capabilities, configured);
  const canCreate = blockedReason === null && !pending;

  return (
    <form
      aria-label="Start a new conversation"
      // Dispatched manually so a failed create keeps the chosen mode and job.
      onSubmit={(event) => {
        event.preventDefault();
        if (!canCreate || inFlight.current) return;
        inFlight.current = true;
        const formData = new FormData(event.currentTarget);
        startTransition(() => dispatch(formData));
      }}
      className="flex flex-col gap-3 rounded-lg border border-[var(--border)] bg-white p-4"
    >
      <h3 className="text-base font-semibold">Start a new conversation</h3>

      <fieldset className="flex flex-col gap-2" disabled={pending}>
        <legend className="mb-1 text-sm font-medium">
          Mode — fixed for the whole conversation
        </legend>
        {modes.map((option) => {
          const inputId = `${idBase}-mode-${option}`;
          return (
            <div
              key={option}
              className="flex items-start gap-3 rounded border border-[var(--border)] px-3 pb-2"
            >
              <input
                type="radio"
                id={inputId}
                name="mode"
                value={option}
                className="mt-3 h-5 w-5 shrink-0"
                checked={selectedMode === option}
                aria-describedby={`${inputId}-desc`}
                onChange={() => setMode(option)}
              />
              <div className="flex flex-1 flex-col">
                <label
                  htmlFor={inputId}
                  className="flex min-h-11 cursor-pointer items-center text-sm font-medium"
                >
                  {ASSISTANT_MODE_LABELS[option]}
                </label>
                <p
                  id={`${inputId}-desc`}
                  className="text-xs text-[var(--status-neutral)]"
                >
                  {ASSISTANT_MODE_DESCRIPTIONS[option]}
                </p>
              </div>
            </div>
          );
        })}
      </fieldset>

      {fixedJob ? (
        <>
          <input type="hidden" name="job_id" value={floorJob?.jobId ?? ""} />
          <p className="text-sm">
            <span className="font-medium">Scope: </span>
            {floorJob ? floorJob.label : "Whole work order"}
          </p>
        </>
      ) : (
        <div className="flex flex-col gap-1">
          <label htmlFor={`${idBase}-job`} className="text-sm font-medium">
            Job (optional)
          </label>
          <select
            id={`${idBase}-job`}
            name="job_id"
            className="select"
            value={jobId}
            disabled={pending}
            onChange={(event) => setJobId(event.target.value)}
          >
            <option value="">Whole work order</option>
            {jobs.map((job) => (
              <option key={job.jobId} value={job.jobId}>
                {job.label}
              </option>
            ))}
          </select>
        </div>
      )}

      {blockedReason ? (
        <p role="status" className="text-sm text-[var(--status-neutral)]">
          {blockedReason}
        </p>
      ) : null}
      {state.error ? (
        <p role="alert" className="text-sm text-red-700">
          {state.error}
        </p>
      ) : null}

      <div>
        <button type="submit" className="btn btn-primary" disabled={!canCreate}>
          {pending ? "Starting…" : "Start conversation"}
        </button>
      </div>
    </form>
  );
}
