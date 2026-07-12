import Link from "next/link";
import type { WorkOrderStatus } from "@/lib/database/types";
import { FlagBadges } from "@/components/status/FlagBadges";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { getWorkOrderNextAction } from "@/lib/status/pipeline";

export type WorkOrderCardData = {
  work_order_id: string;
  work_order_number: string;
  external_invoice_number?: string | null;
  status: WorkOrderStatus;
  flags: string[];
  primary_photo_url?: string | null;
  motorcycle: {
    year: number;
    make: string;
    model: string;
    vin?: string | null;
    customer: {
      first_name: string;
      last_name: string;
      phone?: string | null;
    } | null;
  } | null;
  primary_technician?: {
    first_name: string;
    last_name: string;
  } | null;
};

function statusStripClass(status: WorkOrderStatus): string {
  const map: Partial<Record<WorkOrderStatus, string>> = {
    waiting_for_customer_approval: "wo-card-strip-warning",
    waiting_for_parts: "wo-card-strip-waiting",
    ready_for_technician: "wo-card-strip-success",
    in_progress: "wo-card-strip-info",
    quality_check: "wo-card-strip-warning",
    ready_for_pickup: "wo-card-strip-success",
    on_hold: "wo-card-strip-muted",
    cancelled: "wo-card-strip-danger",
  };
  return map[status] ?? "wo-card-strip-neutral";
}

function statusAccentClass(status: WorkOrderStatus): string {
  const map: Partial<Record<WorkOrderStatus, string>> = {
    waiting_for_customer_approval: "wo-card-accent-warning",
    waiting_for_parts: "wo-card-accent-waiting",
    ready_for_technician: "wo-card-accent-success",
    in_progress: "wo-card-accent-info",
    quality_check: "wo-card-accent-warning",
    ready_for_pickup: "wo-card-accent-success",
    on_hold: "wo-card-accent-muted",
    cancelled: "wo-card-accent-danger",
  };
  return map[status] ?? "wo-card-accent-neutral";
}

export function WorkOrderCard({
  workOrder,
  compact = false,
  showPhoto = false,
}: {
  workOrder: WorkOrderCardData;
  compact?: boolean;
  /** Larger photo hero for Cards grid / photo-forward layouts. */
  showPhoto?: boolean;
}) {
  const customer = workOrder.motorcycle?.customer;
  const bike = workOrder.motorcycle;
  const nextAction = getWorkOrderNextAction(workOrder.status, workOrder.flags);
  const customerName = customer
    ? `${customer.first_name} ${customer.last_name}`
    : "Unknown customer";
  const bikeLabel = bike
    ? `${bike.year} ${bike.make} ${bike.model}`
    : "No motorcycle";
  const photoUrl = workOrder.primary_photo_url ?? null;
  const showPhotoFrame = showPhoto || Boolean(photoUrl);

  return (
    <Link
      href={`/work_orders/${workOrder.work_order_id}`}
      className={[
        "wo-card",
        compact ? "wo-card-compact" : "",
        showPhoto ? "wo-card-photo" : photoUrl ? "wo-card-thumb" : "",
        statusAccentClass(workOrder.status),
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div
        className={`wo-card-strip ${statusStripClass(workOrder.status)}`}
        aria-hidden
      />
      {showPhotoFrame ? (
        <div className="wo-card-photo-frame" aria-hidden={!photoUrl}>
          {photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- signed storage URLs
            <img
              src={photoUrl}
              alt=""
              className="wo-card-photo-img"
              loading="lazy"
            />
          ) : (
            <div className="wo-card-photo-placeholder">
              <svg
                viewBox="0 0 48 32"
                className="wo-card-photo-placeholder-icon"
                aria-hidden
              >
                <path
                  d="M8 22c2-6 6-10 10-11 3 4 7 6 12 6 2 0 4-.4 6-1.2L40 22H8z"
                  fill="currentColor"
                  opacity="0.35"
                />
                <circle cx="16" cy="12" r="3" fill="currentColor" opacity="0.45" />
                <path
                  d="M6 24h36v2H6z"
                  fill="currentColor"
                  opacity="0.25"
                />
              </svg>
            </div>
          )}
        </div>
      ) : null}
      <div className="wo-card-body">
        <div className="wo-card-hero">
          <p className="wo-card-bike">{bikeLabel}</p>
          <p className="wo-card-customer">{customerName}</p>
          {customer?.phone ? (
            <p className="wo-card-meta">{customer.phone}</p>
          ) : null}
        </div>

        <div className="wo-card-footer">
          <div className="wo-card-id-row">
            <span className="wo-card-number">{workOrder.work_order_number}</span>
            {workOrder.external_invoice_number ? (
              <span className="wo-card-invoice">
                Square invoicing {workOrder.external_invoice_number}
              </span>
            ) : null}
          </div>
          <StatusBadge status={workOrder.status} />
          {workOrder.primary_technician ? (
            <p className="wo-card-meta">
              Tech: {workOrder.primary_technician.first_name}{" "}
              {workOrder.primary_technician.last_name}
            </p>
          ) : null}
          {workOrder.flags.length > 0 ? (
            <FlagBadges flags={workOrder.flags.slice(0, compact ? 2 : 4)} />
          ) : null}
          <p className="wo-card-next-action">
            <span className="wo-card-next-label">Next:</span> {nextAction}
          </p>
        </div>
      </div>
    </Link>
  );
}
