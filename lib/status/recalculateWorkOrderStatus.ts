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
};

function isActiveJob(status: string) {
  return status !== "cancelled" && status !== "declined";
}

function isWaitingPartStatus(status: string) {
  return status === "needed" || status === "ordered";
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
  } = input;

  if (
    currentStatus === "completed" ||
    currentStatus === "cancelled" ||
    currentStatus === "on_hold"
  ) {
    return currentStatus;
  }

  if (jobs.some((job) => job.status === "waiting_for_approval")) {
    return "waiting_for_customer_approval";
  }

  if (
    jobs.some((job) => job.status === "waiting_for_parts") ||
    jobs.some((job) => jobHasWaitingParts(job, parts))
  ) {
    return "waiting_for_parts";
  }

  if (jobs.some((job) => job.status === "in_progress")) {
    return "in_progress";
  }

  const activeJobs = jobs.filter((job) => isActiveJob(job.status));
  const allActiveCompleted =
    activeJobs.length > 0 && activeJobs.every((job) => job.status === "completed");

  // Pending recommendations are parallel: approve → new docket job (unfinished
  // again), decline → no job (finished path preserved). They must not block
  // original-job complete or peer QC. Only jobs waiting_for_approval freeze WO.

  if (allActiveCompleted && !qualityCheckComplete) {
    return "quality_check";
  }

  if (allActiveCompleted && qualityCheckComplete) {
    if (safetyRequired && !safetyCheckComplete) {
      return "safety_check";
    }
    return "ready_for_pickup";
  }

  // Ignore already-completed jobs — approved recommendation work after finish
  // must land back on ready_for_technician, not fall through to "open".
  const unfinishedJobs = activeJobs.filter((job) => job.status !== "completed");
  const allReadyForTechnician =
    unfinishedJobs.length > 0 &&
    unfinishedJobs.every(
      (job) => job.status === "approved" || job.status === "ready_to_start"
    );

  if (allReadyForTechnician) {
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
  const { data: workOrder, error: woError } = await supabase
    .from("work_order")
    .select(
      "work_order_id, status, location_id, quality_checked_at, quality_checked_by_user_id, safety_checked_at, safety_checked_by_user_id, safety_required, safety_waived"
    )
    .eq("work_order_id", workOrderId)
    .single();

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
  });

  if (nextStatus === workOrder.status) {
    return nextStatus;
  }

  const { error: updateError } = await supabase
    .from("work_order")
    .update({ status: nextStatus, updated_at: new Date().toISOString() })
    .eq("work_order_id", workOrderId);

  if (updateError) throw updateError;

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

  return nextStatus;
}
