import Link from "next/link";
import { formatDateTime } from "@/lib/datetime/format";
import {
  ASSISTANT_MODE_LABELS,
  ASSISTANT_PHASE_LABELS,
  ASSISTANT_STATUS_LABELS,
  ASSISTANT_TRIGGER_LABELS,
  askOtomotoThreadHref,
  type AskOtomotoRoute,
  type AskOtomotoSubheadingLevel,
  type AskOtomotoThreadListItem,
} from "@/lib/diagnostics/askOtomotoView";

export function AskOtomotoThreadList({
  route,
  threads,
  selectedThreadId,
  historyUnavailable = false,
  headingLevel = 3,
}: {
  route: AskOtomotoRoute;
  threads: AskOtomotoThreadListItem[];
  selectedThreadId: string | null;
  /** The panel already announces the load error; don't also claim "none". */
  historyUnavailable?: boolean;
  headingLevel?: AskOtomotoSubheadingLevel;
}) {
  const Heading = headingLevel === 4 ? "h4" : "h3";
  return (
    <nav aria-label="Ask OTOMOTO conversations" className="flex flex-col gap-2">
      <Heading className="text-sm font-semibold">Conversations</Heading>
      {threads.length === 0 ? (
        historyUnavailable ? null : (
          <p className="text-sm text-[var(--status-neutral)]">No conversations yet.</p>
        )
      ) : (
        <ul className="flex flex-col gap-2">
          {threads.map((item) => {
            const selected = item.threadId === selectedThreadId;
            return (
              <li key={item.threadId}>
                <Link
                  href={askOtomotoThreadHref(route, item.threadId)}
                  aria-current={selected ? "page" : undefined}
                  className={[
                    "flex min-h-11 flex-col gap-0.5 rounded border px-3 py-2 text-sm",
                    selected
                      ? "border-[var(--accent)] bg-[var(--surface-muted)]"
                      : "border-[var(--border)] bg-white",
                  ].join(" ")}
                >
                  <span className="font-semibold">
                    {ASSISTANT_MODE_LABELS[item.mode]}
                  </span>
                  <span>
                    {item.jobId ? (item.jobLabel ?? "Job") : "Whole work order"}
                  </span>
                  {item.triggerType ? (
                    <span className="self-start rounded-full bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-900">
                      {ASSISTANT_TRIGGER_LABELS[item.triggerType]}
                    </span>
                  ) : null}
                  <span className="text-xs text-[var(--status-neutral)]">
                    {ASSISTANT_STATUS_LABELS[item.status]}
                    {item.diagnosticPhase
                      ? ` · ${ASSISTANT_PHASE_LABELS[item.diagnosticPhase]}`
                      : ""}
                    {" · "}
                    <time dateTime={item.updatedAt}>
                      {formatDateTime(item.updatedAt)}
                    </time>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </nav>
  );
}
