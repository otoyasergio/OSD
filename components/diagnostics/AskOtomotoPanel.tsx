"use client";

import { useId } from "react";
import Link from "next/link";
import { AskOtomotoNewConversation } from "@/components/diagnostics/AskOtomotoNewConversation";
import { AskOtomotoThreadList } from "@/components/diagnostics/AskOtomotoThreadList";
import {
  AskOtomotoThreadPanel,
  assistantUnavailableCopy,
} from "@/components/diagnostics/AskOtomotoThreadPanel";
import {
  askOtomotoThreadHref,
  type AskOtomotoHeadingLevel,
  type AskOtomotoPanelData,
  type AskOtomotoSubheadingLevel,
} from "@/lib/diagnostics/askOtomotoView";

/**
 * Shared Ask OTOMOTO surface for the office work-order tab and the floor job
 * packet. All data arrives pre-authorized and minimized from the server.
 */
export function AskOtomotoPanel({
  route,
  threads,
  selectedThreadId,
  workspace,
  jobs,
  defaultJobId,
  photos,
  config,
  capabilities,
  historyUnavailable = false,
  headingLevel = 2,
}: AskOtomotoPanelData & { headingLevel?: AskOtomotoHeadingLevel }) {
  const headingId = useId();
  const Heading = headingLevel === 3 ? "h3" : "h2";
  const subheadingLevel: AskOtomotoSubheadingLevel = headingLevel === 3 ? 4 : 3;
  const selectedUnavailable = selectedThreadId !== null && workspace === null;
  const workspaceJobId = workspace?.thread.jobId ?? null;
  const workspaceJobLabel = workspaceJobId
    ? (jobs.find((job) => job.jobId === workspaceJobId)?.label ??
      threads.find((item) => item.threadId === workspace?.thread.threadId)?.jobLabel ??
      null)
    : null;

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-4">
      <header className="flex flex-col gap-2">
        <Heading id={headingId} className="text-lg font-semibold">
          Ask OTOMOTO
        </Heading>
        <p className="text-sm text-[var(--status-neutral)]">
          AI drafts for staff review. Nothing here changes the work order unless you save
          a reviewed note.
        </p>
        <div className="rounded border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2 text-xs text-[var(--status-neutral)]">
          <p>
            No live OEM, service manual, web, recall, or Ontario inspection lookup. Not
            installed: universal diagnostic tree, official inspection report template,
            exact-model OEM manuals and wiring diagrams.
          </p>
          {config.modelLabel ? <p className="mt-1">Model: {config.modelLabel}</p> : null}
        </div>
        {!config.configured ? (
          <p
            role="status"
            className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950"
          >
            {assistantUnavailableCopy(config.reason)}
          </p>
        ) : null}
      </header>

      {historyUnavailable ? (
        <p role="alert" className="text-sm text-red-700">
          Conversation history could not be loaded. Refresh to try again.
        </p>
      ) : null}
      {selectedUnavailable ? (
        <p
          role="alert"
          className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950"
        >
          The selected conversation is unavailable. It may have been removed or you may
          not have access. Choose another conversation or start a new one.
        </p>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(15rem,20rem)_minmax(0,1fr)]">
        <AskOtomotoThreadList
          route={route}
          threads={threads}
          selectedThreadId={selectedThreadId}
          historyUnavailable={historyUnavailable}
          headingLevel={subheadingLevel}
        />
        <div className="flex min-w-0 flex-col gap-3">
          {workspace ? (
            <>
              <Link
                href={askOtomotoThreadHref(route, null)}
                className="btn btn-secondary self-start"
              >
                New conversation
              </Link>
              <AskOtomotoThreadPanel
                key={workspace.thread.threadId}
                workspace={workspace}
                photos={photos}
                canMutate={capabilities.canMutate}
                preview={capabilities.preview}
                readOnly={capabilities.readOnly}
                lockReason={capabilities.lockReason}
                configured={config.configured}
                canPromoteNotes={capabilities.canPromoteNotes}
                jobLabel={workspaceJobLabel}
                headingLevel={subheadingLevel}
              />
            </>
          ) : (
            <AskOtomotoNewConversation
              key={`${route.surface}:${defaultJobId ?? ""}`}
              route={route}
              jobs={jobs}
              defaultJobId={defaultJobId}
              capabilities={capabilities}
              configured={config.configured}
              headingLevel={subheadingLevel}
            />
          )}
        </div>
      </div>
    </section>
  );
}
