export type UserRole =
  | "owner"
  | "manager"
  | "service_advisor"
  | "technician"
  | "admin";

export type UserStatus = "active" | "inactive" | "suspended";

export type WorkOrderStatus =
  | "draft"
  | "open"
  | "inspection_in_progress"
  | "waiting_for_customer_approval"
  | "waiting_for_parts"
  | "ready_for_technician"
  | "in_progress"
  | "quality_check"
  | "ready_for_pickup"
  | "completed"
  | "cancelled"
  | "on_hold";

export type JobStatus =
  | "draft"
  | "waiting_for_approval"
  | "approved"
  | "declined"
  | "waiting_for_parts"
  | "ready_to_start"
  | "in_progress"
  | "completed"
  | "cancelled";

export type PartStatus =
  | "needed"
  | "in_stock"
  | "ordered"
  | "installed"
  | "not_required"
  | "cancelled";

export type InspectionResultStatus =
  | "ok"
  | "future_attention"
  | "immediate_attention";

export type RecommendationSeverity =
  | "future_attention"
  | "immediate_attention"
  | "safety_critical";

export type RecommendationStatus =
  | "pending"
  | "approved"
  | "declined"
  | "converted_to_job"
  | "deferred";
