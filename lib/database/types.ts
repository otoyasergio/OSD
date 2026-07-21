import type { SupabaseClient } from "@supabase/supabase-js";

export type UserRole =
  | "owner"
  | "manager"
  | "service_advisor"
  | "technician"
  | "head_tech"
  | "admin"
  | "time_clock_kiosk";

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
  | "safety_check"
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
  "needed" | "in_stock" | "ordered" | "installed" | "not_required" | "cancelled";

export type InspectionResultStatus =
  "ok" | "future_attention" | "immediate_attention" | "not_applicable";

export type RecommendationSeverity =
  "future_attention" | "immediate_attention" | "safety_critical";

export type RecommendationStatus =
  "pending" | "approved" | "declined" | "converted_to_job" | "deferred";

export type PhotoCategory =
  | "front"
  | "rear"
  | "left_side"
  | "right_side"
  | "odometer"
  | "vin"
  | "damage"
  | "accessories"
  | "fuel_level"
  | "other"
  | "inspection_tires"
  | "inspection_brakes"
  | "inspection_forks"
  | "inspection_item"
  | "job_proof";

export type TechnicianNoteType =
  | "general"
  | "diagnostic_finding"
  | "customer_concern_confirmed"
  | "customer_concern_not_found"
  | "parts_issue"
  | "road_test"
  | "quality_check"
  | "internal_warning"
  | "proof_exception";

export type AdminFlagReason = "parts" | "approval" | "tool" | "quality" | "other";

/** Pit Board park reasons (job.floor_park_reason). */
export type FloorParkReason = "parts" | "approval" | "tool" | "other" | "swapped";

/** Who owns a parked wait (job.floor_wait_owner). */
export type FloorWaitOwner = "front_desk" | "technician";

/** Derived Pit Board stamp / status for the tech floor UI. */
export type PitBoardStatus =
  | "offered"
  | "next"
  | "bench"
  | "waiting"
  | "check"
  | "done"
  | "qcpassed"
  | "qcfailed"
  | "safety";

// ---------------------------------------------------------------------------
// Workflow V2 facets (additive redesign; legacy unions above stay authoritative
// for V1 rows until cutover).
// ---------------------------------------------------------------------------

export type WorkOrderLifecycleState =
  "draft" | "active" | "on_hold" | "closed" | "cancelled";

export type JobWorkState =
  "planned" | "ready" | "in_progress" | "completed" | "cancelled";

export type JobPricingMode = "itemized" | "fixed_package" | "no_charge";

export type AuthorizationDecision = "approved" | "declined" | "deferred";

export type EstimateStatus = "draft" | "presented" | "confirmed" | "superseded" | "void";

export type EstimateLineKind = "labor" | "part" | "fee" | "discount" | "package";

export type EstimateActorType = "customer_portal" | "staff" | "system_migration";

export type EstimateDecisionMethod =
  | "portal"
  | "in_person"
  | "phone"
  | "email"
  | "sms"
  | "legacy_explicit"
  | "legacy_inferred";

export type FindingSeverity = "advisory" | "immediate" | "safety_critical";

export type RecommendationDisposition =
  "open" | "deferred" | "declined" | "scheduled" | "resolved" | "void";

export type JobBlockerKind =
  "parts" | "approval" | "tool" | "other" | "swapped" | "work_order_hold";

export type JobBlockerOwner = "front_desk" | "technician" | "parts" | "qc";

export type PartRequirementState =
  | "planned"
  | "to_order"
  | "ordered"
  | "partially_received"
  | "received"
  | "allocated"
  | "installed"
  | "waived"
  | "cancelled"
  | "returned";

export type CheckOutcome = "passed" | "failed";

export type InvoiceStatus =
  "draft" | "issued" | "partially_paid" | "paid" | "void" | "refunded";

export type PaymentStatus =
  "pending" | "succeeded" | "failed" | "voided" | "partially_refunded" | "refunded";

export type DomainEventActorType = "staff" | "customer" | "system" | "webhook";

export type WorkOrderDisplayStage =
  | "intake"
  | "findings"
  | "estimate_draft"
  | "estimate_presented"
  | "authorization_pending"
  | "parts_wait"
  | "ready_to_work"
  | "in_progress"
  | "qc"
  | "safety"
  | "invoice_due"
  | "paid"
  | "closed"
  | "on_hold"
  | "cancelled";

export type { Database } from "@/lib/database/supabase.generated";

/** Untyped until createClient is wired with generated Database generics. */
export type DbClient = SupabaseClient;
