import type { JobStatus, WorkOrderStatus } from "@/lib/database/types";
import { JOB_STATUS_LABELS, WORK_ORDER_STATUS_LABELS } from "@/lib/status/labels";

const WORK_ORDER_STATUS_STYLES: Record<WorkOrderStatus, string> = {
  draft: "bg-[var(--status-neutral-bg)] text-[var(--status-neutral-fg)]",
  open: "bg-[var(--status-info-bg)] text-[var(--status-info-fg)]",
  inspection_in_progress: "bg-[var(--status-info-bg)] text-[var(--status-info-fg)]",
  waiting_for_customer_approval:
    "bg-[var(--status-warning-bg)] text-[var(--status-warning-fg)]",
  waiting_for_parts: "bg-[var(--status-waiting-bg)] text-[var(--status-waiting-fg)]",
  ready_for_technician: "bg-[var(--status-success-bg)] text-[var(--status-success-fg)]",
  in_progress: "bg-[var(--status-info-bg)] text-[var(--status-info-fg)]",
  quality_check: "bg-[var(--status-warning-bg)] text-[var(--status-warning-fg)]",
  safety_check: "bg-[var(--status-warning-bg)] text-[var(--status-warning-fg)]",
  ready_for_pickup: "bg-[var(--status-success-bg)] text-[var(--status-success-fg)]",
  completed: "bg-[var(--status-neutral-bg)] text-[var(--status-neutral-fg)]",
  cancelled: "bg-[var(--status-danger-bg)] text-[var(--status-danger-fg)]",
  on_hold: "bg-[var(--status-neutral-bg)] text-[var(--status-neutral-fg)]",
};

const JOB_STATUS_STYLES: Record<JobStatus, string> = {
  draft: "bg-[var(--status-neutral-bg)] text-[var(--status-neutral-fg)]",
  waiting_for_approval: "bg-[var(--status-warning-bg)] text-[var(--status-warning-fg)]",
  approved: "bg-[var(--status-success-bg)] text-[var(--status-success-fg)]",
  declined: "bg-[var(--status-danger-bg)] text-[var(--status-danger-fg)]",
  waiting_for_parts: "bg-[var(--status-waiting-bg)] text-[var(--status-waiting-fg)]",
  ready_to_start: "bg-[var(--status-success-bg)] text-[var(--status-success-fg)]",
  in_progress: "bg-[var(--status-info-bg)] text-[var(--status-info-fg)]",
  completed: "bg-[var(--status-neutral-bg)] text-[var(--status-neutral-fg)]",
  cancelled: "bg-[var(--status-danger-bg)] text-[var(--status-danger-fg)]",
};

type WorkOrderBadgeProps = {
  status: WorkOrderStatus;
  kind?: "work_order";
  size?: "default" | "large";
};

type JobBadgeProps = {
  status: JobStatus;
  kind: "job";
  size?: "default" | "large";
};

export function StatusBadge(props: WorkOrderBadgeProps | JobBadgeProps) {
  const { size = "default" } = props;
  const sizeClass = size === "large" ? "badge-lg" : "";

  if (props.kind === "job") {
    return (
      <span
        className={`badge ${sizeClass} ${JOB_STATUS_STYLES[props.status] ?? JOB_STATUS_STYLES.draft}`}
      >
        {JOB_STATUS_LABELS[props.status] ?? props.status}
      </span>
    );
  }

  return (
    <span
      className={`badge ${sizeClass} ${WORK_ORDER_STATUS_STYLES[props.status] ?? WORK_ORDER_STATUS_STYLES.draft}`}
    >
      {WORK_ORDER_STATUS_LABELS[props.status] ?? props.status}
    </span>
  );
}
