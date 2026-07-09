import type {
  WorkOrderStatus,
  JobStatus,
  InspectionResultStatus,
  RecommendationSeverity,
} from "@/lib/database/types";

export const WORK_ORDER_STATUS_LABELS: Record<WorkOrderStatus, string> = {
  draft: "Draft",
  open: "Open",
  inspection_in_progress: "Inspection In Progress",
  waiting_for_customer_approval: "Waiting For Customer Approval",
  waiting_for_parts: "Waiting For Parts",
  ready_for_technician: "Ready For Technician",
  in_progress: "In Progress",
  quality_check: "Quality Check",
  ready_for_pickup: "Ready For Pickup",
  completed: "Completed",
  cancelled: "Cancelled",
  on_hold: "On Hold",
};

export const JOB_STATUS_LABELS: Record<JobStatus, string> = {
  draft: "Draft",
  waiting_for_approval: "Waiting For Approval",
  approved: "Approved",
  declined: "Declined",
  waiting_for_parts: "Waiting For Parts",
  ready_to_start: "Ready To Start",
  in_progress: "In Progress",
  completed: "Completed",
  cancelled: "Cancelled",
};

export const INSPECTION_RESULT_LABELS: Record<InspectionResultStatus, string> = {
  ok: "OK",
  future_attention: "Future Attention",
  immediate_attention: "Immediate Attention",
};

export const RECOMMENDATION_SEVERITY_LABELS: Record<
  RecommendationSeverity,
  string
> = {
  future_attention: "Future Attention",
  immediate_attention: "Immediate Attention",
  safety_critical: "Safety Critical",
};
