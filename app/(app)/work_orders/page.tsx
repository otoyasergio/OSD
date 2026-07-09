import Link from "next/link";
import { listWorkOrdersForActiveLocation } from "@/lib/services/workOrders";
import { canCreateWorkOrder } from "@/lib/permissions";
import { getCurrentAppUser } from "@/lib/auth/session";
import { redirect } from "next/navigation";
import { FlagBadges } from "@/components/status/FlagBadges";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";

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
        actions={
          canCreate ? (
            <Link href="/work_orders/new" className="btn btn-primary">
              New work order
            </Link>
          ) : undefined
        }
      />

      {workOrders.length === 0 ? (
        <EmptyState description="No work orders at this location yet." />
      ) : (
        <div className="data-table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Number</th>
                <th>Invoice</th>
                <th>Customer</th>
                <th>Bike</th>
                <th>Status</th>
                <th>Tech</th>
                <th>Flags</th>
              </tr>
            </thead>
            <tbody>
              {workOrders.map((wo) => (
                <tr key={wo.work_order_id}>
                  <td>
                    <Link
                      href={`/work_orders/${wo.work_order_id}`}
                      className="data-table-link"
                    >
                      {wo.work_order_number}
                    </Link>
                  </td>
                  <td className="text-[var(--status-neutral-fg)]">
                    {wo.external_invoice_number ?? "—"}
                  </td>
                  <td className="text-[var(--status-neutral-fg)]">
                    {wo.motorcycle?.customer
                      ? `${wo.motorcycle.customer.first_name} ${wo.motorcycle.customer.last_name}`
                      : "—"}
                  </td>
                  <td className="text-[var(--status-neutral-fg)]">
                    {wo.motorcycle
                      ? `${wo.motorcycle.year} ${wo.motorcycle.make} ${wo.motorcycle.model}`
                      : "—"}
                  </td>
                  <td>
                    <StatusBadge status={wo.status} />
                  </td>
                  <td className="text-[var(--status-neutral-fg)]">
                    {wo.primary_technician
                      ? `${wo.primary_technician.first_name} ${wo.primary_technician.last_name}`
                      : "—"}
                  </td>
                  <td>
                    <FlagBadges flags={wo.flags} />
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
