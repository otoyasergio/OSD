import Link from "next/link";
import type { UxEvent } from "@/lib/services/uxEvents";
import type { AuditFilterOption } from "@/lib/services/audit";
import { formatDateTime } from "@/lib/datetime/format";

const SELECT_CLASS =
  "min-h-11 w-full rounded border border-[var(--border-strong)] bg-white px-3 py-2 text-base text-foreground outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-ring)]";

export function UxEventsPanel({
  events,
  topCodes,
  actors,
  filters,
}: {
  events: UxEvent[];
  topCodes: Array<{ code: string; count: number }>;
  actors: AuditFilterOption[];
  filters: {
    from: string;
    to: string;
    actor_user_id: string;
    event_type: string;
    code: string;
  };
}) {
  return (
    <div className="flex flex-col gap-4">
      {topCodes.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {topCodes.map((row) => (
            <Link
              key={row.code}
              href={`/settings/logs?tab=ux&code=${encodeURIComponent(row.code)}`}
              className="rounded-full border border-[var(--border)] bg-white px-3 py-1 text-sm font-medium text-foreground hover:border-[var(--accent)]"
            >
              {row.code}{" "}
              <span className="text-[var(--status-neutral)]">×{row.count}</span>
            </Link>
          ))}
        </div>
      ) : null}

      <form
        method="get"
        className="grid gap-3 rounded border border-[var(--border)] bg-white p-4 sm:grid-cols-2 lg:grid-cols-3"
      >
        <input type="hidden" name="tab" value="ux" />
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-foreground">From</span>
          <input
            className={SELECT_CLASS}
            type="date"
            name="from"
            defaultValue={filters.from}
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-foreground">To</span>
          <input
            className={SELECT_CLASS}
            type="date"
            name="to"
            defaultValue={filters.to}
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-foreground">Actor</span>
          <select
            className={SELECT_CLASS}
            name="actor_user_id"
            defaultValue={filters.actor_user_id}
          >
            <option value="">All actors</option>
            {actors.map((actor) => (
              <option key={actor.id} value={actor.id}>
                {actor.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-foreground">Type</span>
          <select
            className={SELECT_CLASS}
            name="event_type"
            defaultValue={filters.event_type}
          >
            <option value="">All types</option>
            <option value="action_failed">Action failed</option>
            <option value="user_error">User error</option>
            <option value="friction">Friction</option>
          </select>
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-foreground">Code</span>
          <input
            className={SELECT_CLASS}
            name="code"
            defaultValue={filters.code}
            placeholder="e.g. INSPECTION_INCOMPLETE"
          />
        </label>
        <div className="flex items-end gap-2">
          <button
            type="submit"
            className="min-h-11 rounded bg-[var(--chrome)] px-4 text-sm font-medium text-white hover:bg-[var(--chrome-elevated)]"
          >
            Apply filters
          </button>
          <Link
            href="/settings/logs?tab=ux"
            className="inline-flex min-h-11 items-center rounded border border-[var(--border-strong)] px-4 text-sm font-medium text-foreground hover:bg-[var(--surface-muted)]"
          >
            Clear
          </Link>
        </div>
      </form>

      {events.length === 0 ? (
        <p className="rounded border border-dashed border-[var(--border-strong)] bg-white px-4 py-10 text-center text-[var(--status-neutral)]">
          No UX signals match these filters yet.
        </p>
      ) : (
        <div className="data-table-wrap">
          <table className="data-table min-w-[48rem] text-sm">
            <thead className="border-b border-[var(--border)] bg-[var(--surface-muted)] text-xs uppercase tracking-wide text-[var(--status-neutral)]">
              <tr>
                <th className="px-3 py-2 font-medium">When</th>
                <th className="px-3 py-2 font-medium">Actor</th>
                <th className="px-3 py-2 font-medium">Code</th>
                <th className="px-3 py-2 font-medium">Source</th>
                <th className="px-3 py-2 font-medium">Message</th>
                <th className="px-3 py-2 font-medium">Link</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => {
                const woId =
                  typeof event.context.work_order_id === "string"
                    ? event.context.work_order_id
                    : null;
                return (
                  <tr
                    key={event.event_id}
                    className="border-b border-[var(--border)] align-top last:border-0"
                  >
                    <td className="whitespace-nowrap px-3 py-2 text-[var(--status-neutral)]">
                      {formatDateTime(event.created_at)}
                    </td>
                    <td className="px-3 py-2 text-foreground">
                      {event.actor
                        ? `${event.actor.first_name} ${event.actor.last_name}`
                        : "—"}
                      {event.role ? (
                        <span className="mt-0.5 block text-xs text-[var(--status-neutral)]">
                          {event.role}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs font-medium text-foreground">
                      {event.code}
                    </td>
                    <td className="px-3 py-2 text-[var(--status-neutral)]">
                      {event.source}
                    </td>
                    <td className="max-w-md px-3 py-2 text-foreground">
                      {event.message}
                      {typeof event.context.user_note === "string" &&
                      event.context.user_note ? (
                        <span className="mt-1 block text-xs text-[var(--status-neutral)]">
                          Note: {event.context.user_note}
                        </span>
                      ) : null}
                      {event.context.user_submitted === true ? (
                        <span className="mt-1 block text-xs font-medium text-foreground">
                          Staff-submitted
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2">
                      {woId ? (
                        <Link
                          href={`/work_orders/${woId}`}
                          className="text-sm underline-offset-2 hover:underline"
                        >
                          Work order
                        </Link>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
