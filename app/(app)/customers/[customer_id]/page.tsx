import Link from "next/link";
import { notFound } from "next/navigation";
import { getCustomerById } from "@/lib/services/customers";
import { listMotorcyclesForCustomer } from "@/lib/services/motorcycles";
import { listWorkOrdersForCustomer } from "@/lib/services/filedWorkOrders";
import { CustomerForm } from "@/components/forms/CustomerForm";
import { updateCustomerAction } from "@/app/(app)/customers/actions";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { JOB_STATUS_LABELS } from "@/lib/status/labels";
import type { CustomerWorkOrderSummary } from "@/lib/services/filedWorkOrders";

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function WorkOrderHistoryList({
  items,
  emptyMessage,
  showCompletedDate = false,
}: {
  items: CustomerWorkOrderSummary[];
  emptyMessage: string;
  showCompletedDate?: boolean;
}) {
  if (items.length === 0) {
    return (
      <p className="mt-3 rounded border border-dashed border-zinc-300 bg-white px-4 py-8 text-center text-sm text-zinc-600">
        {emptyMessage}
      </p>
    );
  }

  return (
    <ul className="mt-3 divide-y divide-zinc-100 rounded border border-zinc-200 bg-white">
      {items.map((wo) => {
        const jobSummary =
          wo.jobs.length === 0
            ? "No jobs"
            : wo.jobs
                .map(
                  (job) =>
                    `${job.service_name_snapshot} (${JOB_STATUS_LABELS[job.status] ?? job.status})`
                )
                .join(", ");

        return (
          <li key={wo.work_order_id} className="px-4 py-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <Link
                  href={`/work_orders/${wo.work_order_id}`}
                  className="font-medium text-zinc-900 underline-offset-2 hover:underline"
                >
                  {wo.work_order_number}
                </Link>
                <p className="mt-0.5 text-sm text-zinc-600">
                  {wo.motorcycle_label}
                  {" · "}
                  {wo.location_name}
                  {wo.location_code ? ` (${wo.location_code})` : null}
                </p>
                <p className="mt-1 text-xs text-zinc-500">{jobSummary}</p>
              </div>
              <div className="flex flex-col items-end gap-1">
                <StatusBadge status={wo.status} />
                <span className="text-xs text-zinc-500">
                  {showCompletedDate
                    ? `Completed ${formatDate(wo.completed_at)}`
                    : `Opened ${formatDate(wo.date_created)}`}
                </span>
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export default async function CustomerDetailPage({
  params,
}: {
  params: Promise<{ customer_id: string }>;
}) {
  const { customer_id } = await params;
  const customer = await getCustomerById(customer_id);
  if (!customer) notFound();

  const [motorcycles, history] = await Promise.all([
    listMotorcyclesForCustomer(customer_id),
    listWorkOrdersForCustomer(customer_id),
  ]);
  const updateAction = updateCustomerAction.bind(null, customer_id);

  return (
    <div className="page-stack page-stack--narrow">
      <div>
        <Link
          href="/customers"
          className="text-sm text-zinc-600 underline-offset-2 hover:underline"
        >
          ← Customers
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-900">
          {customer.first_name} {customer.last_name}
        </h1>
        <p className="mt-1 text-sm text-zinc-600">
          {customer.phone ?? "No phone"} · {customer.email ?? "No email"}
        </p>
      </div>

      <section>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold text-zinc-900">Motorcycles</h2>
          <Link
            href={`/motorcycles/new?customer_id=${customer_id}`}
            className="min-h-11 rounded border border-zinc-300 bg-white px-4 py-2.5 text-sm font-semibold text-zinc-800 hover:bg-zinc-100"
          >
            Add motorcycle
          </Link>
        </div>
        {motorcycles.length === 0 ? (
          <p className="mt-3 rounded border border-dashed border-zinc-300 bg-white px-4 py-8 text-center text-sm text-zinc-600">
            No motorcycles for this customer yet.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-zinc-100 rounded border border-zinc-200 bg-white">
            {motorcycles.map((motorcycle) => (
              <li key={motorcycle.motorcycle_id} className="px-4 py-3">
                <Link
                  href={`/motorcycles/${motorcycle.motorcycle_id}`}
                  className="font-medium text-zinc-900 underline-offset-2 hover:underline"
                >
                  {motorcycle.year} {motorcycle.make} {motorcycle.model}
                </Link>
                {motorcycle.vin ? null : (
                  <span className="ml-2 rounded bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
                    Missing VIN
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="text-lg font-semibold text-zinc-900">Open work orders</h2>
        <p className="mt-1 text-sm text-zinc-600">
          Active visits across all locations.
        </p>
        <WorkOrderHistoryList
          items={history.open}
          emptyMessage="No open work orders for this customer."
        />
      </section>

      <section>
        <h2 className="text-lg font-semibold text-zinc-900">
          Completed / filed work orders
        </h2>
        <p className="mt-1 text-sm text-zinc-600">
          Released visits (status Completed), with jobs from each work order.
          Browse all filed work at this location in{" "}
          <Link href="/complete" className="underline-offset-2 hover:underline">
            Complete and filed
          </Link>
          .
        </p>
        <WorkOrderHistoryList
          items={history.filed}
          emptyMessage="No completed work orders filed for this customer yet."
          showCompletedDate
        />
      </section>

      <section>
        <h2 className="text-lg font-semibold text-zinc-900">Edit customer</h2>
        <div className="mt-3">
          <CustomerForm
            action={updateAction}
            customer={customer}
            submitLabel="Save changes"
          />
        </div>
      </section>
    </div>
  );
}
