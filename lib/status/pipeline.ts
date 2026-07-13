import type { WorkOrderStatus } from "@/lib/database/types";

/** Operational visit stages shown on the work-order pipeline (Shopmonkey / Fullbay style). */
export const VISIT_PIPELINE_STAGES = [
  {
    id: "intake",
    label: "Intake",
    shortLabel: "Intake",
    statuses: ["draft", "open"] as WorkOrderStatus[],
  },
  {
    id: "inspection",
    label: "Inspection",
    shortLabel: "Inspect",
    statuses: ["inspection_in_progress"] as WorkOrderStatus[],
  },
  {
    id: "approval",
    label: "Approval",
    shortLabel: "Approve",
    statuses: ["waiting_for_customer_approval"] as WorkOrderStatus[],
  },
  {
    id: "parts",
    label: "Parts",
    shortLabel: "Parts",
    statuses: ["waiting_for_parts"] as WorkOrderStatus[],
  },
  {
    id: "work",
    label: "In shop",
    shortLabel: "Work",
    statuses: ["ready_for_technician", "in_progress"] as WorkOrderStatus[],
  },
  {
    id: "qc",
    label: "Quality check",
    shortLabel: "QC",
    statuses: ["quality_check"] as WorkOrderStatus[],
  },
  {
    id: "pickup",
    label: "Pickup",
    shortLabel: "Pickup",
    statuses: ["ready_for_pickup", "completed"] as WorkOrderStatus[],
  },
] as const;

export type VisitPipelineStageId = (typeof VISIT_PIPELINE_STAGES)[number]["id"];

/** Board columns for the dashboard shop-floor view (detailed). */
export const SHOP_BOARD_COLUMNS = [
  {
    id: "intake",
    label: "Intake",
    statuses: ["draft", "open"] as WorkOrderStatus[],
  },
  {
    id: "inspection",
    label: "Inspection",
    statuses: ["inspection_in_progress"] as WorkOrderStatus[],
  },
  {
    id: "approval",
    label: "Waiting approval",
    statuses: ["waiting_for_customer_approval"] as WorkOrderStatus[],
  },
  {
    id: "parts",
    label: "Waiting parts",
    statuses: ["waiting_for_parts"] as WorkOrderStatus[],
  },
  {
    id: "ready",
    label: "Ready for tech",
    statuses: ["ready_for_technician"] as WorkOrderStatus[],
  },
  {
    id: "in_progress",
    label: "In progress",
    statuses: ["in_progress"] as WorkOrderStatus[],
  },
  {
    id: "qc",
    label: "Quality check",
    statuses: ["quality_check"] as WorkOrderStatus[],
  },
  {
    id: "pickup",
    label: "Ready pickup",
    statuses: ["ready_for_pickup"] as WorkOrderStatus[],
  },
  {
    id: "on_hold",
    label: "On hold",
    statuses: ["on_hold"] as WorkOrderStatus[],
  },
] as const;

/** Calm Track Day gallery — fewer wide stage columns (default board). */
export const GALLERY_BOARD_COLUMNS = [
  {
    id: "gallery_intake",
    label: "Intake",
    statuses: [
      "draft",
      "open",
      "inspection_in_progress",
      "waiting_for_customer_approval",
    ] as WorkOrderStatus[],
  },
  {
    id: "gallery_in_bay",
    label: "In bay",
    statuses: [
      "waiting_for_parts",
      "ready_for_technician",
      "in_progress",
      "on_hold",
    ] as WorkOrderStatus[],
  },
  {
    id: "gallery_qc",
    label: "QC",
    statuses: ["quality_check"] as WorkOrderStatus[],
  },
  {
    id: "gallery_ready",
    label: "Ready",
    statuses: ["ready_for_pickup", "completed"] as WorkOrderStatus[],
  },
] as const;

export function getGalleryStageForStatus(status: WorkOrderStatus): {
  label: string;
  tone: "teal" | "orange" | "muted" | "danger";
} {
  if (status === "cancelled") return { label: "Cancelled", tone: "danger" };
  if (status === "on_hold") return { label: "On hold", tone: "danger" };
  for (const column of GALLERY_BOARD_COLUMNS) {
    if ((column.statuses as readonly WorkOrderStatus[]).includes(status)) {
      if (column.id === "gallery_in_bay" && status === "in_progress") {
        return { label: column.label, tone: "orange" };
      }
      if (column.id === "gallery_qc") return { label: column.label, tone: "orange" };
      if (column.id === "gallery_ready") return { label: column.label, tone: "muted" };
      return { label: column.label, tone: "teal" };
    }
  }
  return { label: status, tone: "muted" };
}

export function getPipelineStageIndex(status: WorkOrderStatus): number {
  if (status === "cancelled") return -1;
  if (status === "on_hold") return -2;

  const index = VISIT_PIPELINE_STAGES.findIndex((stage) =>
    stage.statuses.includes(status)
  );
  return index >= 0 ? index : 0;
}

export function getWorkOrderNextAction(status: WorkOrderStatus, flags: string[]): string {
  if (status === "cancelled") return "Work order cancelled";
  if (status === "on_hold") return "Resume when customer or parts are ready";
  if (status === "completed") return "Vehicle picked up — archive when done";

  if (flags.includes("Admin flag")) return "Clear admin flag and unblock technician";
  if (flags.includes("No intake photos")) return "Capture intake photos";
  if (flags.includes("Contract unsigned")) return "Get drop-off agreement signed";
  if (flags.includes("Missing VIN")) return "Record VIN on motorcycle profile";
  if (flags.includes("Incomplete inspection")) return "Complete inspection checklist";
  if (flags.includes("Needs approval")) return "Record customer approval on jobs";
  if (flags.includes("Waiting for parts")) return "Receive parts and update status";
  if (flags.includes("Safety-critical")) return "Review safety-critical recommendations";
  if (flags.includes("Overdue")) return "Update ETA or expedite work";

  switch (status) {
    case "draft":
    case "open":
      return "Start inspection";
    case "inspection_in_progress":
      return "Finish inspection and add recommendations";
    case "waiting_for_customer_approval":
      return "Follow up for customer approval";
    case "waiting_for_parts":
      return "Mark parts received when they arrive";
    case "ready_for_technician":
      return "Pull on Tech floor or assign technician";
    case "in_progress":
      return "Complete assigned jobs";
    case "quality_check":
      return "Peer QC on Tech floor or complete QC on Overview";
    case "ready_for_pickup":
      return "Notify customer — ready for pickup";
    default:
      return "Review work order details";
  }
}
