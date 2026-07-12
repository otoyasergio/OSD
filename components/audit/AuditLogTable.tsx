import Link from "next/link";
import type { AuditLogEntry, AuditFilterOption } from "@/lib/services/audit";

const SELECT_CLASS =
  "min-h-11 w-full rounded border border-zinc-300 bg-white px-3 py-2 text-base text-zinc-900 outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10";

const INPUT_CLASS = SELECT_CLASS;

export function AuditLogTable({
  entries,
  actors,
  locations,
  entityTypes,
  filters,
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
  };
}) {
  return (
    <div className="flex flex-col gap-4">
      <form
        method="get"
        className="grid gap-3 rounded border border-zinc-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-3"
      >
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-zinc-800">
            From
          </span>
          <input
            className={INPUT_CLASS}
            type="date"
            name="from"
            defaultValue={filters.from}
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-zinc-800">
            To
          </span>
          <input
            className={INPUT_CLASS}
            type="date"
            name="to"
            defaultValue={filters.to}
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-zinc-800">
            Actor
          </span>
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
          <span className="mb-1.5 block text-sm font-medium text-zinc-800">
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
          <span className="mb-1.5 block text-sm font-medium text-zinc-800">
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
        <div className="flex items-end gap-2">
          <button
            type="submit"
            className="min-h-11 rounded bg-zinc-900 px-4 text-sm font-medium text-white hover:bg-zinc-800"
          >
            Apply filters
          </button>
          <Link
            href="/settings/audit"
            className="inline-flex min-h-11 items-center rounded border border-zinc-300 px-4 text-sm font-medium text-zinc-800 hover:bg-zinc-50"
          >
            Clear
          </Link>
        </div>
      </form>

      {entries.length === 0 ? (
        <p className="rounded border border-dashed border-zinc-300 bg-white px-4 py-10 text-center text-zinc-600">
          No audit log entries match these filters.
        </p>
      ) : (
        <div className="data-table-wrap">
          <table className="data-table min-w-[48rem] text-sm">
            <thead className="border-b border-zinc-200 bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500">
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
                  className="border-b border-zinc-100 align-top last:border-0"
                >
                  <td className="whitespace-nowrap px-3 py-2 text-zinc-600">
                    {new Date(entry.created_at).toLocaleString()}
                  </td>
                  <td className="px-3 py-2 text-zinc-900">
                    {entry.actor
                      ? `${entry.actor.first_name} ${entry.actor.last_name}`
                      : "—"}
                  </td>
                  <td className="px-3 py-2 text-zinc-700">
                    {entry.location?.name ?? "—"}
                  </td>
                  <td className="px-3 py-2 font-medium text-zinc-900">
                    {entry.action}
                  </td>
                  <td className="px-3 py-2 text-zinc-700">
                    <span className="block">{entry.entity_type}</span>
                    {entry.entity_id ? (
                      <span className="font-mono text-xs text-zinc-500">
                        {entry.entity_id.slice(0, 8)}…
                      </span>
                    ) : null}
                  </td>
                  <td className="max-w-md px-3 py-2 text-zinc-800">
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
