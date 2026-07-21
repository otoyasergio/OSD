import type {
  AuthorizationDecision,
  JobStatus,
  JobWorkState,
  WorkOrderLifecycleState,
  WorkOrderStatus,
} from "@/lib/database/types";

/**
 * Bidirectional mapping between the legacy single job status and the V2
 * facets (work progress + customer authorization + parts blocker). Used by
 * dual-write projection and the backfill; must round-trip every legacy
 * status without silent loss.
 */

export type JobFacets = {
  workState: JobWorkState;
  /** Effective decision; null = pending. */
  authorization: AuthorizationDecision | null;
  /** Job is on a presented estimate awaiting a decision. */
  presented: boolean;
  /** An open parts blocker keeps authorized work from starting. */
  partsBlocked: boolean;
};

export function mapLegacyJobStatus(status: JobStatus): JobFacets {
  switch (status) {
    case "draft":
      return {
        workState: "planned",
        authorization: null,
        presented: false,
        partsBlocked: false,
      };
    case "waiting_for_approval":
      return {
        workState: "planned",
        authorization: null,
        presented: true,
        partsBlocked: false,
      };
    case "approved":
      return {
        workState: "planned",
        authorization: "approved",
        presented: true,
        partsBlocked: false,
      };
    case "declined":
      return {
        workState: "planned",
        authorization: "declined",
        presented: true,
        partsBlocked: false,
      };
    case "waiting_for_parts":
      return {
        workState: "planned",
        authorization: "approved",
        presented: true,
        partsBlocked: true,
      };
    case "ready_to_start":
      return {
        workState: "ready",
        authorization: "approved",
        presented: true,
        partsBlocked: false,
      };
    case "in_progress":
      return {
        workState: "in_progress",
        authorization: "approved",
        presented: true,
        partsBlocked: false,
      };
    case "completed":
      return {
        workState: "completed",
        authorization: "approved",
        presented: true,
        partsBlocked: false,
      };
    case "cancelled":
      return {
        workState: "cancelled",
        authorization: null,
        presented: false,
        partsBlocked: false,
      };
  }
}

/**
 * Project V2 facets back onto the legacy enum so old app instances and
 * reports keep working during dual-write. Faithful to legacy semantics,
 * including its known limitations.
 */
export function projectLegacyJobStatus(facets: JobFacets): JobStatus {
  if (facets.workState === "cancelled") return "cancelled";
  if (facets.workState === "completed") return "completed";
  if (facets.workState === "in_progress") return "in_progress";

  if (facets.authorization === "declined") return "declined";
  // Legacy has no deferred job status; deferred stays visible as declined-for-now.
  if (facets.authorization === "deferred") return "declined";

  if (facets.authorization === "approved") {
    if (facets.partsBlocked) return "waiting_for_parts";
    return facets.workState === "ready" ? "ready_to_start" : "approved";
  }

  return facets.presented ? "waiting_for_approval" : "draft";
}

export function mapLegacyWorkOrderStatus(
  status: WorkOrderStatus
): WorkOrderLifecycleState {
  switch (status) {
    case "draft":
      return "draft";
    case "completed":
      return "closed";
    case "cancelled":
      return "cancelled";
    case "on_hold":
      return "on_hold";
    default:
      return "active";
  }
}

export type LegacyWorkOrderProjectionInput = {
  lifecycleState: WorkOrderLifecycleState;
  anyPendingDecision: boolean;
  anyPartsBlocked: boolean;
  anyInProgress: boolean;
  anyReady: boolean;
  allAuthorizedWorkComplete: boolean;
  hasCompletedWork: boolean;
  qcPassed: boolean;
  safetyRequired: boolean;
  safetyPassed: boolean;
  agreementSigned: boolean;
  inspectionInProgress: boolean;
};

/**
 * Legacy work-order status projection for dual-write. Intentionally mirrors
 * the historical derivation (a pending decision freezes the visit) because
 * legacy consumers depend on it; the V2 rollup is the corrected view.
 */
export function projectLegacyWorkOrderStatus(
  input: LegacyWorkOrderProjectionInput
): WorkOrderStatus {
  switch (input.lifecycleState) {
    case "draft":
      return "draft";
    case "closed":
      return "completed";
    case "cancelled":
      return "cancelled";
    case "on_hold":
      return "on_hold";
    case "active":
      break;
  }

  if (input.anyPendingDecision) return "waiting_for_customer_approval";
  if (input.anyPartsBlocked && !input.anyInProgress) return "waiting_for_parts";
  if (input.anyInProgress) return "in_progress";

  if (input.allAuthorizedWorkComplete && input.hasCompletedWork) {
    if (!input.qcPassed) return "quality_check";
    if (input.safetyRequired && !input.safetyPassed) return "safety_check";
    return "ready_for_pickup";
  }

  if (input.anyReady && input.agreementSigned) return "ready_for_technician";
  if (input.inspectionInProgress) return "inspection_in_progress";
  return "open";
}
