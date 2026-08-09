import Link from "next/link";
import { listWorkOrdersForActiveLocation } from "@/lib/services/workOrders";
import { canCreateWorkOrder, isFloorTech, staffHomePath } from "@/lib/permissions";
import { getCurrentAppUser } from "@/lib/auth/session";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { WorkOrderCard } from "@/components/work_orders/WorkOrderCard";

export const dynamic = "force-dynamic";

export default async function WorkOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const user = await getCurrentAppUser();
  if (!user) redirect("/login");
  if (isFloorTech(user.role)) redirect(staffHomePath(user.role));

  const { q = "" } = await searchParams;
  const workOrders = await listWorkOrdersForActiveLocation(q);
  const canCreate = canCreateWorkOrder(user.role);

  return (
    <div className="page-stack">
      <PageHeader
        title="Work orders"
        subtitle="All repair orders at this location."
        actions={
          canCreate ? (
            <Link href="/work_orders/new" className="btn btn-primary">
              New work order
            </Link>
          ) : undefined
        }
      />

      <form method="get" className="filter-panel sm:grid-cols-1 lg:grid-cols-2">
        <label className="block sm:col-span-2 lg:col-span-1">
          <span className="field-label">Search</span>
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder="Customer, work order, bike, or VIN"
            aria-label="Search work orders"
            className="input"
          />
        </label>
        <div className="flex items-end gap-2">
          <button type="submit" className="btn btn-primary">
            Search
          </button>
          {q ? (
            <Link href="/work_orders" className="btn btn-secondary">
              Clear
            </Link>
          ) : null}
        </div>
      </form>

      {workOrders.length === 0 ? (
        <EmptyState
          variant={q ? "search" : "work-orders"}
          title={q ? "No matches" : "No work orders yet"}
          description={
            q
              ? `No work orders match “${q}”.`
              : "Create the first work order to start tracking a visit."
          }
          action={
            !q && canCreate
              ? { href: "/work_orders/new", label: "Create work order" }
              : undefined
          }
        />
      ) : (
        <>
          <p className="text-sm text-[var(--status-neutral)]">
            <Link href="/dashboard?view=board" className="data-table-link">
              Open workflow board
            </Link>
            {" · "}
            <Link href="/dashboard?view=list" className="data-table-link">
              List by status
            </Link>
          </p>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {workOrders.map((wo) => (
              <WorkOrderCard key={wo.work_order_id} workOrder={wo} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
