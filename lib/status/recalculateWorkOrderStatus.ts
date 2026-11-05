import type {
  DbClient,
  JobStatus,
  PartStatus,
  WorkOrderStatus,
} from "@/lib/database/types";
import { addTimelineEvent } from "@/lib/timeline/addTimelineEvent";
import { TimelineEventType } from "@/lib/timeline/events";
import { addAuditLog } from "@/lib/audit/addAuditLog";
import { isSafetyRequired } from "@/lib/status/safetyRequired";
import { checkoutEvidenceOverridden } from "@/lib/status/checkoutEvidence";
import { loadCommittedCheckoutCoverage } from "@/lib/services/checkoutEvidence";
import { isUndefinedColumnError } from "@/lib/database/schemaCompat";
import { entersSafetyColumn } from "@/lib/status/safetyReadyText";
import { isWorkableService } from "@/lib/technician/floorQueue";

export type DeriveJobInput = {
  status: JobStatus | string;
  job_id?: string;
  service_name_snapshot?: string | null;
};

export type DerivePartInput = {
  job_id: string;
  status: PartStatus | string;
};

export type DeriveWorkOrderStatusInput = {
  currentStatus: WorkOrderStatus | string;
  jobs: DeriveJobInput[];
  parts: DerivePartInput[];
  inspectionComplete: boolean;
  qualityCheckComplete: boolean;
  /** When false, do not auto-promote to ready_for_technician. Omit/undefined allows promote. */
  hasSignedAgreement?: boolean;
  /** When true, visit must pass Head Tech safety after QC. */
  safetyRequired?: boolean;
  safetyCheckComplete?: boolean;
  checkoutEvidenceRequired?: boolean;
  checkoutEvidenceComplete?: boolean;
  checkoutEvidenceOverridden?: boolean;
  /**
   * Owner placed this bike from the board without a quality check.
   * Keep that placement instead of forcing the visit back into QC.
   */
  qualityCheckWaived?: boolean;
};

function isActiveJob(status: string) {
  return status !== "cancelled" && status !== "declined";
}

function isWaitingPartStatus(status: string) {
  return status === "needed" || status === "ordered";
}

function partsForJob(job: DeriveJobInput, parts: DerivePartInput[]): DerivePartInput[] {
  if (!job.job_id) return [];
  return parts.filter((part) => part.job_id === job.job_id);
}

/** A service the floor can still wrench. A blocking part makes in-progress unworkable. */
export function jobIsWorkable(job: DeriveJobInput, parts: DerivePartInput[]): boolean {
  return isWorkableService({
    status: String(job.status),
    parts: partsForJob(job, parts),
  });
}

function jobHasWaitingParts(job: DeriveJobInput, parts: DerivePartInput[]): boolean {
  if (!job.job_id) return false;
  if (
    job.status !== "approved" &&
    job.status !== "waiting_for_parts" &&
    job.status !== "ready_to_start" &&
    job.status !== "in_progress"
  ) {
    return false;
  }
  return parts.some(
    (part) => part.job_id === job.job_id && isWaitingPartStatus(part.status)
  );
}

export function deriveWorkOrderStatus(
  input: DeriveWorkOrderStatusInput
): WorkOrderStatus {
  const {
    currentStatus,
    jobs,
    parts,
    inspectionComplete,
    qualityCheckComplete,
    hasSignedAgreement,
    safetyRequired = false,
    safetyCheckComplete = false,
    checkoutEvidenceRequired = false,
    checkoutEvidenceComplete = false,
    checkoutEvidenceOverridden = false,
    qualityCheckWaived = false,
  } = input;

  if (
    currentStatus === "completed" ||
    currentStatus === "cancelled" ||
    currentStatus === "on_hold" ||
    currentStatus === "insurance"
  ) {
    return currentStatus;
  }

  const workableJobs = jobs.filter((job) => jobIsWorkable(job, parts));
  const anyWorkable = workableJobs.length > 0;

  // A partial approval or parts block stays in the bay while another service
  // can still be worked. The front desk row is only for a bike with nothing left.
  if (!anyWorkable && jobs.some((job) => job.status === "waiting_for_approval")) {
    return "waiting_for_customer_approval";
  }

  // A drop into Ready for safety stays there until the check is stamped.
  // A failed check adds a job that needs approval, which already returned above
  // when that job is the only remaining work.
  if (currentStatus === "safety_check" && !safetyCheckComplete) {
    return "safety_check";
  }

  if (
    !anyWorkable &&
    (jobs.some((job) => job.status === "waiting_for_parts") ||
      jobs.some((job) => jobHasWaitingParts(job, parts)))
  ) {
    return "waiting_for_parts";
  }

  // An in-progress job with a blocking part does not keep the visit out of
  // the parts or approval row once nothing else is workable. Those returns
  // already happened above. A blocked clock plus other workable work stays here.
  if (
    workableJobs.some((job) => job.status === "in_progress") ||
    (anyWorkable && jobs.some((job) => job.status === "in_progress"))
  ) {
    return "in_progress";
  }

  const activeJobs = jobs.filter((job) => isActiveJob(job.status));
  const allActiveCompleted =
    activeJobs.length > 0 && activeJobs.every((job) => job.status === "completed");

  // Pending recommendations are parallel: approve → new docket job (unfinished
  // again), decline → no job (finished path preserved). They must not block
  // original-job complete or peer QC. Only jobs waiting_for_approval freeze WO.

  if (allActiveCompleted && !qualityCheckComplete) {
    // Storage is not a departure. An outstanding final inspection must not
    // pull the bike back out after it was placed there.
    if (currentStatus === "in_storage") return "in_storage";
    if (qualityCheckWaived && currentStatus !== "quality_check") {
      return currentStatus as WorkOrderStatus;
    }
    return "quality_check";
  }

  if (allActiveCompleted && qualityCheckComplete) {
    // Checkout photos and final inspection are for departure. A stored bike
    // keeps its column until someone drags it out or unfinished work appears.
    if (currentStatus === "in_storage") {
      return "in_storage";
    }
    // Owner or admin put the card in this category or on a tech. Leave it
    // there even when final inspection is already stamped.
    if (qualityCheckWaived) {
      return currentStatus as WorkOrderStatus;
    }
    if (safetyRequired && !safetyCheckComplete) {
      return "safety_check";
    }
    if (
      checkoutEvidenceRequired &&
      !checkoutEvidenceComplete &&
      !checkoutEvidenceOverridden
    ) {
      return safetyRequired ? "safety_check" : "quality_check";
    }
    return "ready_for_pickup";
  }

  // Ignore already-completed jobs — approved recommendation work after finish
  // must land back on ready_for_technician, not fall through to "open".
  const unfinishedJobs = activeJobs.filter((job) => job.status !== "completed");
  // Waiting siblings must not hide a service that can still be worked.
  const readyPool = anyWorkable ? workableJobs : unfinishedJobs;
  const allReadyForTechnician =
    readyPool.length > 0 &&
    readyPool.every(
      (job) => job.status === "approved" || job.status === "ready_to_start"
    );

  if (allReadyForTechnician) {
    // Booked intake services are already approved. A visit that has not
    // reached the floor yet still starts at arrival inspection. Bikes
    // already in the bay, in storage, or ready for pickup keep that place.
    const beforeWork =
      currentStatus === "draft" ||
      currentStatus === "open" ||
      currentStatus === "inspection_in_progress" ||
      currentStatus === "waiting_for_customer_approval" ||
      currentStatus === "ready_for_technician";
    if (!inspectionComplete && beforeWork) {
      return "inspection_in_progress";
    }
    if (hasSignedAgreement === false) {
      // Do not auto-promote; demote only if already incorrectly on ready.
      if (currentStatus === "ready_for_technician") {
        return "open";
      }
      return currentStatus as WorkOrderStatus;
    }
    return "ready_for_technician";
  }

  if (!inspectionComplete && currentStatus === "inspection_in_progress") {
    return "inspection_in_progress";
  }

  return "open";
}

export async function recalculateWorkOrderStatus(
  supabase: DbClient,
  workOrderId: string,
  actorUserId: string | null = null
) {
  const workOrderSelect =
    "work_order_id, status, location_id, quality_checked_at, quality_checked_by_user_id, quality_check_waived, safety_checked_at, safety_checked_by_user_id, safety_required, safety_waived, checkout_evidence_required, checkout_evidence_override_at, checkout_evidence_override_by_user_id, checkout_evidence_override_reason";
  const workOrderSelectLegacy = workOrderSelect.replace(", quality_check_waived", "");
  let workOrderResult = await supabase
    .from("work_order")
    .select(workOrderSelect)
    .eq("work_order_id", workOrderId)
    .single();
  if (isUndefinedColumnError(workOrderResult.error, "quality_check_waived")) {
    workOrderResult = await supabase
      .from("work_order")
      .select(workOrderSelectLegacy)
      .eq("work_order_id", workOrderId)
      .single();
  }
  const { data: workOrder, error: woError } = workOrderResult;

  if (woError) throw woError;
  if (!workOrder) throw new Error("WORK_ORDER_NOT_FOUND");

  const { data: jobs, error: jobsError } = await supabase
    .from("job")
    .select("job_id, status, service_name_snapshot")
    .eq("work_order_id", workOrderId);

  if (jobsError) throw jobsError;

  const jobIds = (jobs ?? []).map((job: { job_id: string }) => job.job_id);
  let parts: DerivePartInput[] = [];

  if (jobIds.length > 0) {
    const { data: partRows, error: partsError } = await supabase
      .from("part")
      .select("job_id, status")
      .in("job_id", jobIds);

    if (partsError) throw partsError;
    parts = partRows ?? [];
  }

  const { data: inspection, error: inspectionError } = await supabase
    .from("inspection")
    .select("completed_at")
    .eq("work_order_id", workOrderId)
    .maybeSingle();

  if (inspectionError) throw inspectionError;

  const { data: agreement, error: agreementError } = await supabase
    .from("drop_off_agreement")
    .select("agreement_id")
    .eq("work_order_id", workOrderId)
    .maybeSingle();

  if (agreementError) throw agreementError;

  const safetyRequired = isSafetyRequired({
    safety_required: (workOrder.safety_required as boolean | null) ?? null,
    safety_waived: Boolean(workOrder.safety_waived),
    jobs: jobs ?? [],
  });

  const checkoutCoverage = await loadCommittedCheckoutCoverage(supabase, workOrderId);
  const activeJobs = (jobs ?? []).filter(
    (job: { status: string }) => job.status !== "cancelled" && job.status !== "declined"
  );
  const allActiveCompleted =
    activeJobs.length > 0 &&
    activeJobs.every((job: { status: string }) => job.status === "completed");
  const storedWaiver = Boolean(
    (workOrder as { quality_check_waived?: boolean | null }).quality_check_waived
  );
  // New unfinished work cancels an owner placement so the next finish enters QC.
  const clearWaiver = storedWaiver && !allActiveCompleted;
  const nextStatus = deriveWorkOrderStatus({
    currentStatus: workOrder.status,
    jobs: jobs ?? [],
    parts,
    inspectionComplete: Boolean(inspection?.completed_at),
    qualityCheckComplete: Boolean(
      workOrder.quality_checked_at || workOrder.quality_checked_by_user_id
    ),
    hasSignedAgreement: Boolean(agreement),
    safetyRequired,
    safetyCheckComplete: Boolean(
      workOrder.safety_checked_at || workOrder.safety_checked_by_user_id
    ),
    checkoutEvidenceRequired: Boolean(workOrder.checkout_evidence_required),
    checkoutEvidenceComplete: checkoutCoverage.complete,
    checkoutEvidenceOverridden: checkoutEvidenceOverridden(workOrder),
    qualityCheckWaived: storedWaiver && allActiveCompleted,
  });

  if (nextStatus === workOrder.status && !clearWaiver) {
    return nextStatus;
  }

  const now = new Date().toISOString();
  const statusPatch: Record<string, unknown> = { updated_at: now };
  if (nextStatus !== workOrder.status) statusPatch.status = nextStatus;
  if (clearWaiver) statusPatch.quality_check_waived = false;
  if (workOrder.status === "in_storage" && nextStatus !== "in_storage") {
    statusPatch.stored_at = null;
  }

  let { error: updateError } = await supabase
    .from("work_order")
    .update(statusPatch)
    .eq("work_order_id", workOrderId);
  const optionalColumns = ["stored_at", "quality_check_waived"] as const;
  while (
    updateError &&
    optionalColumns.some(
      (column) => column in statusPatch && isUndefinedColumnError(updateError, column)
    )
  ) {
    const missing = optionalColumns.find(
      (column) => column in statusPatch && isUndefinedColumnError(updateError, column)
    );
    if (!missing) break;
    delete statusPatch[missing];
    if (!("status" in statusPatch) && !("quality_check_waived" in statusPatch)) {
      return nextStatus;
    }
    ({ error: updateError } = await supabase
      .from("work_order")
      .update(statusPatch)
      .eq("work_order_id", workOrderId));
  }

  if (updateError) throw updateError;

  if (nextStatus === workOrder.status) {
    return nextStatus;
  }

  await addTimelineEvent(supabase, {
    work_order_id: workOrderId,
    user_id: actorUserId,
    event_type: TimelineEventType.WORK_ORDER_STATUS_CHANGED,
    entity_type: "work_order",
    entity_id: workOrderId,
    description: `Work order status changed to ${nextStatus}`,
    old_value: { status: workOrder.status },
    new_value: { status: nextStatus },
  });

  await addAuditLog(supabase, {
    actor_user_id: actorUserId,
    location_id: workOrder.location_id,
    action: "work_order_status_changed",
    entity_type: "work_order",
    entity_id: workOrderId,
    description: `Work order status changed to ${nextStatus}`,
    old_value: { status: workOrder.status },
    new_value: { status: nextStatus },
  });

  if (nextStatus === "quality_check") {
    const { autoAssignPeerQc } = await import("@/lib/services/peerQc");
    await autoAssignPeerQc(supabase, workOrderId, workOrder.location_id, actorUserId);
  }

  if (entersSafetyColumn(workOrder.status, nextStatus)) {
    try {
      const { sendSafetyReadyText } = await import("@/lib/services/safetyReadySms");
      await sendSafetyReadyText(supabase, workOrderId);
    } catch {
      // A failed text does not undo the status change.
    }
  }

  return nextStatus;
}
