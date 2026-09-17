import Link from "next/link";
import type { AuditLogEntry, AuditFilterOption } from "@/lib/services/audit";
import { formatDateTime } from "@/lib/datetime/format";
import { AuditExportButton } from "@/components/logs/AuditExportButton";

const SELECT_CLASS =
  "min-h-11 w-full rounded border border-[var(--border-strong)] bg-white px-3 py-2 text-base text-foreground outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-ring)]";

const INPUT_CLASS = SELECT_CLASS;

export function AuditLogTable({
  entries,
  actors,
  locations,
  entityTypes,
  filters,
  formBasePath,
}: {
  entries: AuditLogEntry[];
  actors: AuditFilterOption[];
  locations: AuditFilterOption[];
  entityTypes: string[];
  filters: {
    from: string;
    to: string;
    actor_user_id: string;
    location_id: string;
    entity_type: string;
    action: string;
  };
  formBasePath?: string;
}) {
  const basePath = formBasePath ?? "/settings/logs";
  const auditQuery = basePath.includes("logs") ? "tab=audit&" : "";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <AuditExportButton entries={entries} />
      </div>
      <form
        method="get"
        className="grid gap-3 rounded border border-[var(--border)] bg-white p-4 sm:grid-cols-2 lg:grid-cols-3"
      >
        {basePath.includes("logs") ? (
          <input type="hidden" name="tab" value="audit" />
        ) : null}
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-foreground">From</span>
          <input
            className={INPUT_CLASS}
            type="date"
            name="from"
            defaultValue={filters.from}
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-foreground">To</span>
          <input
            className={INPUT_CLASS}
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
          <span className="mb-1.5 block text-sm font-medium text-foreground">
            Location
          </span>
          <select
            className={SELECT_CLASS}
            name="location_id"
            defaultValue={filters.location_id}
          >
            <option value="">All locations</option>
            {locations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-foreground">
            Entity type
          </span>
          <select
            className={SELECT_CLASS}
            name="entity_type"
            defaultValue={filters.entity_type}
          >
            <option value="">All entities</option>
            {entityTypes.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-foreground">Action</span>
          <input
            className={INPUT_CLASS}
            name="action"
            defaultValue={filters.action}
            placeholder="Search action…"
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
            href={`${basePath}${auditQuery ? `?${auditQuery.slice(0, -1)}` : ""}`}
            className="inline-flex min-h-11 items-center rounded border border-[var(--border-strong)] px-4 text-sm font-medium text-foreground hover:bg-[var(--surface-muted)]"
          >
            Clear
          </Link>
        </div>
      </form>

      {entries.length === 0 ? (
        <p className="rounded border border-dashed border-[var(--border-strong)] bg-white px-4 py-10 text-center text-[var(--status-neutral)]">
          No audit log entries match these filters.
        </p>
      ) : (
        <div className="data-table-wrap">
          <table className="data-table min-w-[48rem] text-sm">
            <thead className="border-b border-[var(--border)] bg-[var(--surface-muted)] text-xs uppercase tracking-wide text-[var(--status-neutral)]">
              <tr>
                <th className="px-3 py-2 font-medium">When</th>
                <th className="px-3 py-2 font-medium">Actor</th>
                <th className="px-3 py-2 font-medium">Location</th>
                <th className="px-3 py-2 font-medium">Action</th>
                <th className="px-3 py-2 font-medium">Entity</th>
                <th className="px-3 py-2 font-medium">Description</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr
                  key={entry.audit_log_id}
                  className="border-b border-[var(--border)] align-top last:border-0"
                >
                  <td className="whitespace-nowrap px-3 py-2 text-[var(--status-neutral)]">
                    {formatDateTime(entry.created_at)}
                  </td>
                  <td className="px-3 py-2 text-foreground">
                    {entry.actor
                      ? `${entry.actor.first_name} ${entry.actor.last_name}`
                      : "—"}
                  </td>
                  <td className="px-3 py-2 text-foreground">
                    {entry.location?.name ?? "—"}
                  </td>
                  <td className="px-3 py-2 font-medium text-foreground">
                    {entry.action}
                  </td>
                  <td className="px-3 py-2 text-foreground">
                    <span className="block">{entry.entity_type}</span>
                    {entry.entity_id ? (
                      <span className="font-mono text-xs text-[var(--status-neutral)]">
                        {entry.entity_id.slice(0, 8)}…
                      </span>
                    ) : null}
                  </td>
                  <td className="max-w-md px-3 py-2 text-foreground">
                    {entry.description}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
