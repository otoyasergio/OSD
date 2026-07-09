import Link from "next/link";
import { listWorkOrdersForActiveLocation } from "@/lib/services/workOrders";
import { WORK_ORDER_STATUS_LABELS } from "@/lib/status/labels";
import { canCreateWorkOrder } from "@/lib/permissions";
import { getCurrentAppUser } from "@/lib/auth/session";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function WorkOrdersPage() {
  const user = await getCurrentAppUser();
  if (!user) redirect("/login");

  const workOrders = await listWorkOrdersForActiveLocation();
  const canCreate = canCreateWorkOrder(user.role);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">
          Work orders
        </h1>
        {canCreate ? (
          <Link
            href="/work_orders/new"
            className="min-h-11 rounded bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-zinc-800"
          >
            New work order
          </Link>
        ) : null}
      </div>

      {workOrders.length === 0 ? (
        <p className="mt-8 rounded border border-dashed border-zinc-300 bg-white px-4 py-10 text-center text-zinc-600">
          No work orders at this location yet.
        </p>
      ) : (
        <div className="mt-4 overflow-x-auto rounded border border-zinc-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-zinc-200 bg-zinc-50 text-zinc-600">
              <tr>
                <th className="px-4 py-3 font-medium">Number</th>
                <th className="px-4 py-3 font-medium">Invoice</th>
                <th className="px-4 py-3 font-medium">Customer</th>
                <th className="px-4 py-3 font-medium">Bike</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Tech</th>
                <th className="px-4 py-3 font-medium">Flags</th>
              </tr>
            </thead>
            <tbody>
              {workOrders.map((wo) => (
                <tr
                  key={wo.work_order_id}
                  className="border-b border-zinc-100 last:border-0"
                >
                  <td className="px-4 py-3">
                    <Link
                      href={`/work_orders/${wo.work_order_id}`}
                      className="font-medium text-zinc-900 underline-offset-2 hover:underline"
                    >
                      {wo.work_order_number}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-zinc-700">
                    {wo.external_invoice_number ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-zinc-700">
                    {wo.motorcycle?.customer
                      ? `${wo.motorcycle.customer.first_name} ${wo.motorcycle.customer.last_name}`
                      : "—"}
                  </td>
                  <td className="px-4 py-3 text-zinc-700">
                    {wo.motorcycle
                      ? `${wo.motorcycle.year} ${wo.motorcycle.make} ${wo.motorcycle.model}`
                      : "—"}
                  </td>
                  <td className="px-4 py-3 text-zinc-700">
                    {WORK_ORDER_STATUS_LABELS[wo.status] ?? wo.status}
                  </td>
                  <td className="px-4 py-3 text-zinc-700">
                    {wo.primary_technician
                      ? `${wo.primary_technician.first_name} ${wo.primary_technician.last_name}`
                      : "—"}
                  </td>
                  <td className="px-4 py-3">
                    {wo.flags.length === 0 ? (
                      <span className="text-zinc-400">—</span>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {wo.flags.map((flag) => (
                          <span
                            key={flag}
                            className="rounded bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900"
                          >
                            {flag}
                          </span>
                        ))}
                      </div>
                    )}
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
