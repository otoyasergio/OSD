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

export function WorkOrderCard({
  workOrder,
  compact = false,
}: {
  workOrder: WorkOrderCardData;
  compact?: boolean;
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

  return (
    <Link
      href={`/work_orders/${workOrder.work_order_id}`}
      className={`wo-card ${compact ? "wo-card-compact" : ""}`}
    >
      <div
        className={`wo-card-strip ${statusStripClass(workOrder.status)}`}
        aria-hidden
      />
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
                Inv {workOrder.external_invoice_number}
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
