import type {
  WorkOrderStatus,
  JobStatus,
  InspectionResultStatus,
  RecommendationSeverity,
  RecommendationStatus,
  PartStatus,
  PhotoCategory,
  TechnicianNoteType,
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
  safety_check: "Safety Check",
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
  not_applicable: "N/A",
};

export const RECOMMENDATION_SEVERITY_LABELS: Record<RecommendationSeverity, string> = {
  future_attention: "Future Attention",
  immediate_attention: "Immediate Attention",
  safety_critical: "Safety Critical",
};

export const RECOMMENDATION_STATUS_LABELS: Record<RecommendationStatus, string> = {
  pending: "Pending",
  approved: "Approved",
  declined: "Declined",
  converted_to_job: "Converted To Job",
  deferred: "Deferred",
};

export const PART_STATUS_LABELS: Record<PartStatus, string> = {
  needed: "Needed",
  in_stock: "In Stock",
  ordered: "Ordered",
  installed: "Installed",
  not_required: "Not Required",
  cancelled: "Cancelled",
};

export const PHOTO_CATEGORY_LABELS: Record<PhotoCategory, string> = {
  front: "Front",
  rear: "Rear",
  left_side: "Left Side",
  right_side: "Right Side",
  odometer: "Odometer",
  vin: "VIN",
  damage: "Damage",
  accessories: "Accessories",
  fuel_level: "Fuel Level",
  other: "Other",
  inspection_tires: "Inspection — Tires",
  inspection_brakes: "Inspection — Brakes",
  inspection_forks: "Inspection — Forks",
  inspection_item: "Inspection — Needs work",
  job_proof: "Job proof",
  job_work: "Work photo",
};

/** Categories required at work-order create (also shown as missing on Photos tab). */
export const REQUIRED_PHOTO_CATEGORIES: PhotoCategory[] = [
  "front",
  "rear",
  "left_side",
  "right_side",
  "odometer",
  "vin",
];

/** Human-readable slots for the create-work-order intake grid. */
export const CREATE_INTAKE_PHOTO_SLOTS: Array<{
  category: PhotoCategory;
  label: string;
}> = [
  { category: "front", label: "Front" },
  { category: "rear", label: "Rear" },
  { category: "left_side", label: "Left side" },
  { category: "right_side", label: "Right side" },
  { category: "vin", label: "VIN" },
  {
    category: "odometer",
    label: "Dash / odometer (bike on, mileage showing)",
  },
];

export const TECHNICIAN_NOTE_TYPE_LABELS: Record<TechnicianNoteType, string> = {
  general: "General",
  diagnostic_finding: "Diagnostic Finding",
  customer_concern_confirmed: "Customer Concern Confirmed",
  customer_concern_not_found: "Customer Concern Not Found",
  parts_issue: "Parts Issue",
  road_test: "Road Test",
  quality_check: "Quality Check",
  internal_warning: "Internal Warning",
  proof_exception: "Proof exception",
};
