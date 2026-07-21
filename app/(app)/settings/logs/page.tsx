import Link from "next/link";
import { redirect } from "next/navigation";
import { getRolePreviewContext } from "@/lib/auth/role-preview";
import { canViewAuditLog } from "@/lib/permissions";
import { listAuditFilterOptions, listAuditLogs } from "@/lib/services/audit";
import { listUxEvents, summarizeUxCodes } from "@/lib/services/uxEvents";
import { AuditLogTable } from "@/components/audit/AuditLogTable";
import { UxEventsPanel } from "@/components/logs/UxEventsPanel";

export const dynamic = "force-dynamic";

export default async function OwnerLogsPage({
  searchParams,
}: {
  searchParams: Promise<{
    tab?: string;
    from?: string;
    to?: string;
    actor_user_id?: string;
    location_id?: string;
    entity_type?: string;
    action?: string;
    event_type?: string;
    code?: string;
  }>;
}) {
  const preview = await getRolePreviewContext();
  if (!preview) redirect("/login");
  if (!canViewAuditLog(preview.role)) redirect("/settings");

  const params = await searchParams;
  const tab = params.tab === "ux" ? "ux" : "audit";
  const filters = {
    from: params.from?.trim() || "",
    to: params.to?.trim() || "",
    actor_user_id: params.actor_user_id?.trim() || "",
    location_id: params.location_id?.trim() || "",
    entity_type: params.entity_type?.trim() || "",
    action: params.action?.trim() || "",
    event_type: params.event_type?.trim() || "",
    code: params.code?.trim() || "",
  };

  const options = await listAuditFilterOptions();

  const [uxEvents, auditEntries] = await Promise.all([
    tab === "ux"
      ? listUxEvents({
          from: filters.from || null,
          to: filters.to || null,
          actor_user_id: filters.actor_user_id || null,
          event_type: filters.event_type || null,
          code: filters.code || null,
        })
      : Promise.resolve([]),
    tab === "audit"
      ? listAuditLogs({
          from: filters.from || null,
          to: filters.to || null,
          actor_user_id: filters.actor_user_id || null,
          location_id: filters.location_id || null,
          entity_type: filters.entity_type || null,
          action: filters.action || null,
        })
      : Promise.resolve([]),
  ]);

  const topCodes = await summarizeUxCodes(uxEvents);

  return (
    <div className="flex flex-col gap-4">
      <Link
        href="/settings"
        className="text-sm text-[var(--status-neutral)] underline-offset-2 hover:underline"
      >
        ← Settings
      </Link>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Logs</h1>
        <p className="mt-1 text-sm text-[var(--status-neutral)]">
          Owner-only record of every company action, plus UX friction signals when staff
          hit a wall.
        </p>
      </div>

      <div className="flex flex-wrap gap-2 border-b border-[var(--border)] pb-2">
        <Link
          href="/settings/logs?tab=audit"
          className={
            tab === "audit"
              ? "rounded-md bg-[var(--chrome)] px-3 py-1.5 text-sm font-semibold text-white"
              : "rounded-md px-3 py-1.5 text-sm font-medium text-foreground hover:bg-[var(--surface-muted)]"
          }
        >
          Audit
        </Link>
        <Link
          href="/settings/logs?tab=ux"
          className={
            tab === "ux"
              ? "rounded-md bg-[var(--chrome)] px-3 py-1.5 text-sm font-semibold text-white"
              : "rounded-md px-3 py-1.5 text-sm font-medium text-foreground hover:bg-[var(--surface-muted)]"
          }
        >
          UX signals
        </Link>
      </div>

      {tab === "audit" ? (
        <AuditLogTable
          entries={auditEntries}
          actors={options.actors}
          locations={options.locations}
          entityTypes={options.entityTypes}
          filters={{
            from: filters.from,
            to: filters.to,
            actor_user_id: filters.actor_user_id,
            location_id: filters.location_id,
            entity_type: filters.entity_type,
            action: filters.action,
          }}
          formBasePath="/settings/logs"
        />
      ) : (
        <UxEventsPanel
          events={uxEvents}
          topCodes={topCodes}
          actors={options.actors}
          filters={{
            from: filters.from,
            to: filters.to,
            actor_user_id: filters.actor_user_id,
            event_type: filters.event_type,
            code: filters.code,
          }}
        />
      )}
    </div>
  );
}
