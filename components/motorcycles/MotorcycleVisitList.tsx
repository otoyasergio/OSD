import type { MotorcycleWorkOrderSummary } from "@/lib/services/filedWorkOrders";
import { JOB_STATUS_LABELS } from "@/lib/status/labels";
import { formatDate } from "@/lib/datetime/format";
import { formatMileage } from "@/lib/mileage/format";
import { StatusBadge } from "@/components/ui/StatusBadge";
import Link from "next/link";

function formatMoneyCents(cents: number): string {
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

export function MotorcycleVisitList({
  items,
  emptyMessage,
  showCompletedDate = false,
  showMoney = false,
}: {
  items: MotorcycleWorkOrderSummary[];
  emptyMessage: string;
  showCompletedDate?: boolean;
  showMoney?: boolean;
}) {
  if (items.length === 0) {
    return (
      <p className="mt-3 rounded border border-dashed border-[var(--border-strong)] bg-white px-4 py-8 text-center text-sm text-[var(--status-neutral)]">
        {emptyMessage}
      </p>
    );
  }

  return (
    <ul className="mt-3 divide-y divide-[var(--border)] rounded border border-[var(--border)] bg-white">
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
        const mileageLabel =
          wo.mileage != null
            ? formatMileage(wo.mileage, (wo.mileage_unit as "km" | "mi") ?? "km")
            : null;

        return (
          <li key={wo.work_order_id} className="px-4 py-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <Link
                  href={`/work_orders/${wo.work_order_id}`}
                  className="font-medium text-foreground underline-offset-2 hover:underline"
                >
                  {wo.work_order_number}
                </Link>
                <p className="mt-0.5 text-sm text-[var(--status-neutral)]">
                  {wo.location_name}
                  {wo.location_code ? ` (${wo.location_code})` : null}
                  {mileageLabel ? ` · ${mileageLabel}` : null}
                </p>
                <p className="mt-1 text-xs text-[var(--status-neutral)]">{jobSummary}</p>
              </div>
              <div className="flex flex-col items-end gap-1">
                <StatusBadge status={wo.status} />
                <span className="text-xs text-[var(--status-neutral)]">
                  {showCompletedDate
                    ? `Completed ${formatDate(wo.completed_at) || "—"}`
                    : `Opened ${formatDate(wo.date_created) || "—"}`}
                </span>
                {showMoney && wo.billing_collected_cents > 0 ? (
                  <span className="text-xs font-semibold text-foreground">
                    Collected {formatMoneyCents(wo.billing_collected_cents)}
                  </span>
                ) : null}
                {showMoney &&
                !showCompletedDate &&
                wo.billing_amount_cents > wo.billing_collected_cents ? (
                  <span className="text-xs text-amber-900">
                    Due{" "}
                    {formatMoneyCents(
                      wo.billing_amount_cents - wo.billing_collected_cents
                    )}
                  </span>
                ) : null}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
