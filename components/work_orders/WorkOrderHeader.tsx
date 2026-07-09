import Link from "next/link";
import type { WorkOrderDetail } from "@/lib/services/workOrders";
import { FlagBadges } from "@/components/status/FlagBadges";
import { StatusBadge } from "@/components/ui/StatusBadge";

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleString();
}

export function WorkOrderHeader({ detail }: { detail: WorkOrderDetail }) {
  const customer = detail.motorcycle?.customer;
  const bike = detail.motorcycle;

  return (
    <header className="card overflow-hidden">
      <div className="border-b border-border bg-surface-muted px-4 py-4 sm:px-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold uppercase tracking-wider text-[var(--status-neutral)]">
              Work order
            </p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
              {detail.work_order_number}
            </h1>
            <div className="mt-3">
              <StatusBadge status={detail.status} size="large" />
            </div>
          </div>
          {detail.flags.length > 0 ? (
            <div className="flex flex-col items-end gap-1.5">
              <span className="text-xs font-semibold uppercase tracking-wider text-[var(--status-neutral)]">
                Flags
              </span>
              <FlagBadges flags={detail.flags} empty="" />
            </div>
          ) : null}
        </div>
      </div>

      <dl className="grid gap-x-6 gap-y-4 px-4 py-4 text-sm sm:grid-cols-2 sm:px-5 lg:grid-cols-3">
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-[var(--status-neutral)]">
            External invoice
          </dt>
          <dd className="mt-0.5 font-semibold text-foreground">
            {detail.external_invoice_number ?? "—"}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-[var(--status-neutral)]">
            Customer
          </dt>
          <dd className="mt-0.5 font-semibold text-foreground">
            {customer ? (
              <Link
                href={`/customers/${customer.customer_id}`}
                className="data-table-link"
              >
                {customer.first_name} {customer.last_name}
              </Link>
            ) : (
              "—"
            )}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-[var(--status-neutral)]">
            Contact
          </dt>
          <dd className="mt-0.5 font-semibold text-foreground">
            {customer?.phone || customer?.email || "—"}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-[var(--status-neutral)]">
            Motorcycle
          </dt>
          <dd className="mt-0.5 font-semibold text-foreground">
            {bike ? (
              <Link
                href={`/motorcycles/${bike.motorcycle_id}`}
                className="data-table-link"
              >
                {bike.year} {bike.make} {bike.model}
              </Link>
            ) : (
              "—"
            )}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-[var(--status-neutral)]">
            VIN
          </dt>
          <dd className="mt-0.5 font-mono text-sm font-semibold text-foreground">
            {bike?.vin ?? "—"}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-[var(--status-neutral)]">
            Colour
          </dt>
          <dd className="mt-0.5 font-semibold text-foreground">{bike?.colour ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-[var(--status-neutral)]">
            Mileage
          </dt>
          <dd className="mt-0.5 font-semibold tabular-nums text-foreground">
            {detail.mileage != null ? detail.mileage.toLocaleString() : "—"}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-[var(--status-neutral)]">
            Primary technician
          </dt>
          <dd className="mt-0.5 font-semibold text-foreground">
            {detail.primary_technician
              ? `${detail.primary_technician.first_name} ${detail.primary_technician.last_name}`
              : "—"}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-[var(--status-neutral)]">
            ETA
          </dt>
          <dd className="mt-0.5 font-semibold text-foreground">
            {formatDate(detail.estimated_completion)}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-[var(--status-neutral)]">
            Created
          </dt>
          <dd className="mt-0.5 font-semibold text-foreground">
            {formatDate(detail.date_created)}
          </dd>
        </div>
      </dl>
    </header>
  );
}
