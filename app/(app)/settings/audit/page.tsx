import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentAppUser } from "@/lib/auth/session";
import { canViewAuditLog } from "@/lib/permissions";
import {
  listAuditFilterOptions,
  listAuditLogs,
} from "@/lib/services/audit";
import { AuditLogTable } from "@/components/audit/AuditLogTable";

export const dynamic = "force-dynamic";

export default async function AuditLogPage({
  searchParams,
}: {
  searchParams: Promise<{
    from?: string;
    to?: string;
    actor_user_id?: string;
    location_id?: string;
    entity_type?: string;
  }>;
}) {
  const user = await getCurrentAppUser();
  if (!user) redirect("/login");
  if (!canViewAuditLog(user.role)) redirect("/settings");

  const params = await searchParams;
  const filters = {
    from: params.from?.trim() || "",
    to: params.to?.trim() || "",
    actor_user_id: params.actor_user_id?.trim() || "",
    location_id: params.location_id?.trim() || "",
    entity_type: params.entity_type?.trim() || "",
  };

  const [entries, options] = await Promise.all([
    listAuditLogs({
      from: filters.from || null,
      to: filters.to || null,
      actor_user_id: filters.actor_user_id || null,
      location_id: filters.location_id || null,
      entity_type: filters.entity_type || null,
    }),
    listAuditFilterOptions(),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <Link
        href="/settings"
        className="text-sm text-zinc-600 underline-offset-2 hover:underline"
      >
        ← Settings
      </Link>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">
          Audit log
        </h1>
        <p className="mt-1 text-sm text-zinc-600">
          Owner-only company-wide record of meaningful actions. Showing the
          latest {entries.length} matching entries.
        </p>
      </div>
      <AuditLogTable
        entries={entries}
        actors={options.actors}
        locations={options.locations}
        entityTypes={options.entityTypes}
        filters={filters}
      />
    </div>
  );
}
