import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentAppUser } from "@/lib/auth/session";
import { canViewFiledArchive, staffHomePath } from "@/lib/permissions";
import { listCompletedWorkOrdersForActiveLocation } from "@/lib/services/filedWorkOrders";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { WorkOrderCard } from "@/components/work_orders/WorkOrderCard";
import { formatDate } from "@/lib/datetime/format";

export const dynamic = "force-dynamic";

function formatCompletedAt(value: string | null) {
  if (!value) return null;
  return formatDate(value);
}

export default async function CompleteAndFiledPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const user = await getCurrentAppUser();
  if (!user) redirect("/login");
  if (!canViewFiledArchive(user.role)) redirect(staffHomePath(user.role));

  const { q = "" } = await searchParams;
  const workOrders = await listCompletedWorkOrdersForActiveLocation(q);

  return (
    <div className="page-stack">
      <PageHeader
        title="Complete and filed"
        subtitle="Work orders marked Completed (released). Individual completed jobs still appear on their work order; this archive is for released visits."
      />

      <form method="get" className="filter-panel sm:grid-cols-1 lg:grid-cols-2">
        <label className="block sm:col-span-2 lg:col-span-1">
          <span className="field-label">Search</span>
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder="Customer, work order, bike, or VIN"
            aria-label="Search completed work orders"
            className="input"
          />
        </label>
        <div className="flex items-end gap-2">
          <button type="submit" className="btn btn-primary">
            Search
          </button>
          {q ? (
            <Link href="/complete" className="btn btn-secondary">
              Clear
            </Link>
          ) : null}
        </div>
      </form>

      {workOrders.length === 0 ? (
        <EmptyState
          variant={q ? "search" : "work-orders"}
          title={q ? "No matches" : "Nothing filed yet"}
          description={
            q
              ? `No completed work orders match “${q}”.`
              : "When a visit is released as Completed, it shows up here for this location."
          }
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {workOrders.map((wo) => {
            const completedLabel = formatCompletedAt(wo.completed_at);
            const jobNames = wo.jobs
              .filter((job) => job.status !== "cancelled" && job.status !== "declined")
              .map((job) => job.service_name_snapshot);
            return (
              <div key={wo.work_order_id} className="flex flex-col gap-1">
                <WorkOrderCard workOrder={wo} showPhoto />
                <p className="px-1 text-xs text-[var(--status-neutral)]">
                  {completedLabel ? `Completed ${completedLabel}` : "Completed"}
                  {jobNames.length > 0
                    ? ` · ${jobNames.slice(0, 3).join(", ")}${
                        jobNames.length > 3 ? ` +${jobNames.length - 3}` : ""
                      }`
                    : null}
                </p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
