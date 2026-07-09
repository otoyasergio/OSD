import type { WorkOrderStatus } from "@/lib/database/types";
import { WORK_ORDER_STATUS_LABELS } from "@/lib/status/labels";

const STATUS_STYLES: Record<WorkOrderStatus, string> = {
  draft: "bg-[var(--status-neutral-bg)] text-[var(--status-neutral-fg)]",
  open: "bg-[var(--status-info-bg)] text-[var(--status-info-fg)]",
  inspection_in_progress: "bg-[var(--status-info-bg)] text-[var(--status-info-fg)]",
  waiting_for_customer_approval:
    "bg-[var(--status-warning-bg)] text-[var(--status-warning-fg)]",
  waiting_for_parts: "bg-[var(--status-waiting-bg)] text-[var(--status-waiting-fg)]",
  ready_for_technician: "bg-[var(--status-success-bg)] text-[var(--status-success-fg)]",
  in_progress: "bg-[var(--status-info-bg)] text-[var(--status-info-fg)]",
  quality_check: "bg-[var(--status-warning-bg)] text-[var(--status-warning-fg)]",
  ready_for_pickup: "bg-[var(--status-success-bg)] text-[var(--status-success-fg)]",
  completed: "bg-[var(--status-neutral-bg)] text-[var(--status-neutral-fg)]",
  cancelled: "bg-[var(--status-danger-bg)] text-[var(--status-danger-fg)]",
  on_hold: "bg-[var(--status-neutral-bg)] text-[var(--status-neutral-fg)]",
};

export function StatusBadge({
  status,
  size = "default",
}: {
  status: WorkOrderStatus;
  size?: "default" | "large";
}) {
  const label = WORK_ORDER_STATUS_LABELS[status] ?? status;
  const sizeClass = size === "large" ? "badge-lg" : "";

  return (
    <span
      className={`badge ${sizeClass} ${STATUS_STYLES[status] ?? STATUS_STYLES.draft}`}
    >
      {label}
    </span>
  );
}
