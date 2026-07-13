import Link from "next/link";
import type { WorkOrderDetail } from "@/lib/services/workOrders";
import type { IntakePhoto } from "@/lib/services/photos";
import { FlagBadges } from "@/components/status/FlagBadges";
import { StageChip } from "@/components/ui/StageChip";
import { WorkOrderJobTodo } from "@/components/work_orders/WorkOrderJobTodo";
import { WorkOrderPipeline } from "@/components/work_orders/WorkOrderPipeline";
import { WorkOrderPhotoStrip } from "@/components/work_orders/WorkOrderPhotoStrip";
import { getGalleryStageForStatus, getWorkOrderNextAction } from "@/lib/status/pipeline";
import { formatDateTime } from "@/lib/datetime/format";

const INACTIVE_JOB_STATUSES = new Set(["cancelled", "declined", "completed"]);

function formatDate(value: string | null) {
  if (!value) return "—";
  return formatDateTime(value);
}

function sumActiveEstimatedHours(detail: WorkOrderDetail): number | null {
  const hours = detail.jobs
    .filter((job) => !INACTIVE_JOB_STATUSES.has(job.status))
    .map((job) => job.estimated_labour_snapshot)
    .filter((h): h is number => h != null);
  if (hours.length === 0) return null;
  return hours.reduce((sum, h) => sum + h, 0);
}

export function WorkOrderHeader({
  detail,
  photos = [],
}: {
  detail: WorkOrderDetail;
  photos?: IntakePhoto[];
}) {
  const customer = detail.customer;
  const bike = detail.motorcycle;
  const nextAction = getWorkOrderNextAction(detail.status, detail.flags);
  const estimatedLabourTotal = sumActiveEstimatedHours(detail);
  const galleryStage = getGalleryStageForStatus(detail.status);

  return (
    <header className="card overflow-hidden">
      <div className="border-b border-border bg-surface-muted px-4 py-4 sm:px-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-[var(--status-neutral)]">
                Work order
              </p>
              <StageChip label={galleryStage.label} tone={galleryStage.tone} />
            </div>
            <h1 className="mt-1 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
              {detail.work_order_number}
            </h1>
            {detail.external_invoice_number ? (
              <p className="mt-1 text-sm text-[var(--status-neutral)]">
                Square invoicing {detail.external_invoice_number}
              </p>
            ) : null}
          </div>
          <div className="flex flex-col items-end gap-2">
            {detail.flags.length > 0 ? (
              <FlagBadges flags={detail.flags} empty="" />
            ) : null}
          </div>
        </div>

        {bike || customer ? (
          <div className="mt-4 rounded-lg border border-border bg-surface px-4 py-3">
            {bike ? (
              <p className="text-lg font-bold text-foreground">
                {bike.year} {bike.make} {bike.model}
              </p>
            ) : null}
            {customer ? (
              <p className="mt-1 text-sm font-medium text-[var(--status-neutral-fg)]">
                <Link
                  href={`/customers/${customer.customer_id}`}
                  className="data-table-link"
                >
                  {customer.first_name} {customer.last_name}
                </Link>
                {customer.phone ? ` · ${customer.phone}` : ""}
                {customer.email ? ` · ${customer.email}` : ""}
              </p>
            ) : null}
            {bike?.vin ? (
              <p className="mt-1 font-mono text-xs text-[var(--status-neutral)]">
                VIN {bike.vin}
              </p>
            ) : null}
          </div>
        ) : null}

        <WorkOrderPhotoStrip photos={photos} />

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <p className="text-sm text-[var(--status-neutral)]">
            <span className="font-semibold text-foreground">Next action:</span>{" "}
            {nextAction}
          </p>
          {detail.flags.includes("Contract unsigned") ? (
            <Link
              href={`/work_orders/${detail.work_order_id}/contract`}
              className="btn btn-primary min-h-10 text-sm"
            >
              Sign drop-off agreement
            </Link>
          ) : null}
        </div>
      </div>

      <WorkOrderPipeline status={detail.status} />

      <WorkOrderJobTodo jobs={detail.jobs} workOrderId={detail.work_order_id} />

      <dl className="grid gap-x-6 gap-y-4 px-4 py-4 text-sm sm:grid-cols-2 sm:px-5 lg:grid-cols-3">
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
        {estimatedLabourTotal != null ? (
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-[var(--status-neutral)]">
              Est. labour
            </dt>
            <dd className="mt-0.5 font-semibold tabular-nums text-foreground">
              {Number.isInteger(estimatedLabourTotal)
                ? estimatedLabourTotal
                : estimatedLabourTotal.toFixed(1)}
              h
            </dd>
          </div>
        ) : null}
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-[var(--status-neutral)]">
            Created
          </dt>
          <dd className="mt-0.5 font-semibold text-foreground">
            {formatDate(detail.date_created)}
          </dd>
        </div>
        {bike ? (
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-[var(--status-neutral)]">
              Motorcycle profile
            </dt>
            <dd className="mt-0.5 font-semibold text-foreground">
              <Link
                href={`/motorcycles/${bike.motorcycle_id}`}
                className="data-table-link"
              >
                View motorcycle
              </Link>
            </dd>
          </div>
        ) : null}
      </dl>
    </header>
  );
}
