import Link from "next/link";
import type { WorkOrderDetail } from "@/lib/services/workOrders";
import { WORK_ORDER_STATUS_LABELS } from "@/lib/status/labels";

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleString();
}

export function WorkOrderHeader({ detail }: { detail: WorkOrderDetail }) {
  const customer = detail.motorcycle?.customer;
  const bike = detail.motorcycle;

  return (
    <header className="rounded border border-zinc-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm text-zinc-500">Work order</p>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">
            {detail.work_order_number}
          </h1>
          <p className="mt-1 text-sm text-zinc-600">
            Status:{" "}
            <span className="font-medium text-zinc-900">
              {WORK_ORDER_STATUS_LABELS[detail.status] ?? detail.status}
            </span>
          </p>
        </div>
        {detail.flags.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {detail.flags.map((flag) => (
              <span
                key={flag}
                className="rounded bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900"
              >
                {flag}
              </span>
            ))}
          </div>
        ) : null}
      </div>

      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <dt className="text-zinc-500">External invoice</dt>
          <dd className="font-medium text-zinc-900">
            {detail.external_invoice_number ?? "—"}
          </dd>
        </div>
        <div>
          <dt className="text-zinc-500">Customer</dt>
          <dd className="font-medium text-zinc-900">
            {customer ? (
              <Link
                href={`/customers/${customer.customer_id}`}
                className="underline-offset-2 hover:underline"
              >
                {customer.first_name} {customer.last_name}
              </Link>
            ) : (
              "—"
            )}
          </dd>
        </div>
        <div>
          <dt className="text-zinc-500">Contact</dt>
          <dd className="font-medium text-zinc-900">
            {customer?.phone || customer?.email || "—"}
          </dd>
        </div>
        <div>
          <dt className="text-zinc-500">Motorcycle</dt>
          <dd className="font-medium text-zinc-900">
            {bike ? (
              <Link
                href={`/motorcycles/${bike.motorcycle_id}`}
                className="underline-offset-2 hover:underline"
              >
                {bike.year} {bike.make} {bike.model}
              </Link>
            ) : (
              "—"
            )}
          </dd>
        </div>
        <div>
          <dt className="text-zinc-500">VIN</dt>
          <dd className="font-medium text-zinc-900">{bike?.vin ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-zinc-500">Colour</dt>
          <dd className="font-medium text-zinc-900">{bike?.colour ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-zinc-500">Mileage</dt>
          <dd className="font-medium text-zinc-900">
            {detail.mileage != null ? detail.mileage.toLocaleString() : "—"}
          </dd>
        </div>
        <div>
          <dt className="text-zinc-500">Primary technician</dt>
          <dd className="font-medium text-zinc-900">
            {detail.primary_technician
              ? `${detail.primary_technician.first_name} ${detail.primary_technician.last_name}`
              : "—"}
          </dd>
        </div>
        <div>
          <dt className="text-zinc-500">ETA</dt>
          <dd className="font-medium text-zinc-900">
            {formatDate(detail.estimated_completion)}
          </dd>
        </div>
        <div>
          <dt className="text-zinc-500">Created</dt>
          <dd className="font-medium text-zinc-900">
            {formatDate(detail.date_created)}
          </dd>
        </div>
      </dl>
    </header>
  );
}
