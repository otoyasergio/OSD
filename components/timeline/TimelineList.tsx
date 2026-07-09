"use client";

import { useMemo, useState } from "react";
import type { TimelineEvent } from "@/lib/services/timeline";

export function TimelineList({ events }: { events: TimelineEvent[] }) {
  const [oldestFirst, setOldestFirst] = useState(false);

  const ordered = useMemo(() => {
    const copy = [...events];
    copy.sort((a, b) => {
      const diff =
        new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      return oldestFirst ? diff : -diff;
    });
    return copy;
  }, [events, oldestFirst]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-zinc-600">
          Read-only history of this work order. Events cannot be deleted.
        </p>
        <label className="inline-flex min-h-11 items-center gap-2 text-sm text-zinc-800">
          <input
            type="checkbox"
            className="size-4 rounded border-zinc-300"
            checked={oldestFirst}
            onChange={(e) => setOldestFirst(e.target.checked)}
          />
          Oldest first
        </label>
      </div>

      {ordered.length === 0 ? (
        <p className="rounded border border-dashed border-zinc-300 bg-white px-4 py-10 text-center text-zinc-600">
          No timeline events yet.
        </p>
      ) : (
        <ol className="relative flex flex-col gap-0 border-l border-zinc-200 pl-4">
          {ordered.map((event) => (
            <li key={event.timeline_event_id} className="relative pb-6 last:pb-0">
              <span
                aria-hidden
                className="absolute -left-[1.3125rem] top-1.5 size-2.5 rounded-full border-2 border-white bg-zinc-400"
              />
              <div className="rounded border border-zinc-200 bg-white p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-sm font-semibold text-zinc-900">
                    {event.event_type}
                  </p>
                  <time
                    dateTime={event.created_at}
                    className="text-xs text-zinc-500"
                  >
                    {new Date(event.created_at).toLocaleString()}
                  </time>
                </div>
                <p className="mt-1 text-sm text-zinc-700">{event.description}</p>
                <p className="mt-2 text-xs text-zinc-500">
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
