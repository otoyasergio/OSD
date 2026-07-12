import Link from "next/link";
import { listWorkOrdersForActiveLocation } from "@/lib/services/workOrders";
import { canCreateWorkOrder } from "@/lib/permissions";
import { getCurrentAppUser } from "@/lib/auth/session";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { WorkOrderCard } from "@/components/work_orders/WorkOrderCard";

export const dynamic = "force-dynamic";

export default async function WorkOrdersPage() {
  const user = await getCurrentAppUser();
  if (!user) redirect("/login");

  const workOrders = await listWorkOrdersForActiveLocation();
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

      {workOrders.length === 0 ? (
        <EmptyState
          variant="work-orders"
          title="No work orders yet"
          description="Create the first work order to start tracking a visit."
          action={
            canCreate
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
