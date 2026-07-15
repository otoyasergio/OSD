"use client";

import { useMemo, useState } from "react";
import type { TimelineEvent } from "@/lib/services/timeline";
import { formatDateTime } from "@/lib/datetime/format";

export function TimelineList({ events }: { events: TimelineEvent[] }) {
  const [oldestFirst, setOldestFirst] = useState(false);

  const ordered = useMemo(() => {
    const copy = [...events];
    copy.sort((a, b) => {
      const diff = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      return oldestFirst ? diff : -diff;
    });
    return copy;
  }, [events, oldestFirst]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-[var(--status-neutral)]">
          Who changed what on this work order — every update is attributed and cannot be
          deleted.
        </p>
        <label className="inline-flex min-h-11 items-center gap-2 text-sm text-foreground">
          <input
            type="checkbox"
            className="size-4 rounded border-[var(--border-strong)]"
            checked={oldestFirst}
            onChange={(e) => setOldestFirst(e.target.checked)}
          />
          Oldest first
        </label>
      </div>

      {ordered.length === 0 ? (
        <p className="rounded border border-dashed border-[var(--border-strong)] bg-white px-4 py-10 text-center text-[var(--status-neutral)]">
          No timeline events yet.
        </p>
      ) : (
        <ol className="relative flex flex-col gap-0 border-l border-[var(--border)] pl-4">
          {ordered.map((event) => (
            <li key={event.timeline_event_id} className="relative pb-6 last:pb-0">
              <span
                aria-hidden
                className="absolute -left-[1.3125rem] top-1.5 size-2.5 rounded-full border-2 border-white bg-[var(--status-neutral)]"
              />
              <div className="rounded border border-[var(--border)] bg-white p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-sm font-semibold text-foreground">
                    {event.event_type}
                  </p>
                  <time
                    dateTime={event.created_at}
                    className="text-xs text-[var(--status-neutral)]"
                  >
                    {formatDateTime(event.created_at)}
                  </time>
                </div>
                <p className="mt-1 text-sm text-foreground">{event.description}</p>
                <p className="mt-2 text-xs font-medium text-[var(--status-neutral)]">
                  {event.user
                    ? `${event.user.first_name} ${event.user.last_name}`
                    : "System"}
                  {" · "}
                  {event.entity_type}
                </p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
