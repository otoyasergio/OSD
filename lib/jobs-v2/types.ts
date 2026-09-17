import type {
  AuthorizationDecision,
  CheckOutcome,
  EstimateActorType,
  EstimateDecisionMethod,
  EstimateLineKind,
  EstimateStatus,
  JobBlockerKind,
  JobBlockerOwner,
  JobPricingMode,
  JobWorkState,
  PartRequirementState,
  WorkOrderDisplayStage,
  WorkOrderLifecycleState,
} from "@/lib/database/types";

/** All V2 money is integer CAD cents. */
export type MoneyCents = number;

export type JobV2 = {
  job_id: string;
  work_order_id: string;
  title: string;
  description: string | null;
  work_state: JobWorkState;
  pricing_mode: JobPricingMode;
  assigned_technician_id: string | null;
  started_at: string | null;
  completed_at: string | null;
  lock_version: number;
};

export type JobLaborPlan = {
  job_labor_plan_id: string;
  job_id: string;
  description: string;
  estimated_minutes: number;
  rate_cents_per_hour_snapshot: MoneyCents;
  amount_cents: MoneyCents;
  billable: boolean;
  included_in_package: boolean;
  position: number;
};

export type JobPartRequirement = {
  requirement_id: string;
  job_id: string;
  description: string;
  part_number: string | null;
  quantity_required: number;
  quantity_received: number;
  quantity_allocated: number;
  quantity_installed: number;
  sell_price_cents: MoneyCents | null;
  included_in_package: boolean;
  state: PartRequirementState;
};

export type JobBlocker = {
  job_blocker_id: string;
  job_id: string;
  kind: JobBlockerKind;
  owner: JobBlockerOwner;
  reason: string | null;
  opened_at: string;
  cleared_at: string | null;
};

export type EstimateJobDecision = {
  decision_id: string;
  estimate_version_id: string;
  job_id: string;
  decision: AuthorizationDecision;
  decided_at: string;
  actor_type: EstimateActorType;
  method: EstimateDecisionMethod | null;
  reason: string | null;
};

export type EstimateVersionSummary = {
  estimate_version_id: string;
  estimate_id: string;
  version_no: number;
  status: EstimateStatus;
  subtotal_cents: MoneyCents;
  discount_cents: MoneyCents;
  tax_cents: MoneyCents;
  total_cents: MoneyCents;
  content_hash: string | null;
  presented_at: string | null;
};

export type EstimateLineInput = {
  kind: EstimateLineKind;
  job_id: string | null;
  description: string;
  quantity: number;
  unit_amount_cents: MoneyCents;
  extended_amount_cents: MoneyCents;
  tax_rate_bps: number;
  tax_amount_cents: MoneyCents;
  position: number;
};

export type JobAggregate = {
  job: JobV2;
  /** Effective (latest presented/confirmed version) decision; null = pending. */
  authorization: EstimateJobDecision | null;
  labourPlan: JobLaborPlan[];
  partRequirements: JobPartRequirement[];
  partsReady: boolean;
  blockers: JobBlocker[];
};

export type QualityAttemptSummary = {
  attempt_id: string;
  scope_hash: string;
  outcome: CheckOutcome;
  performed_at: string;
};

export type WorkOrderRollup = {
  displayStage: WorkOrderDisplayStage;
  pendingDecisionCount: number;
  waitingPartsCount: number;
  readyJobCount: number;
  inProgressCount: number;
  completedJobCount: number;
  qcRequired: boolean;
  safetyRequired: boolean;
  invoiceBalanceCents: MoneyCents;
};

export type { WorkOrderDisplayStage, WorkOrderLifecycleState };
