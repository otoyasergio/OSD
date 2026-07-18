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

export type { Database } from "@/lib/database/supabase.generated";

/** Untyped until createClient is wired with generated Database generics. */
export type DbClient = SupabaseClient;
