import type {
  DbClient,
  JobStatus,
  PartStatus,
  WorkOrderStatus,
} from "@/lib/database/types";
import { addTimelineEvent } from "@/lib/timeline/addTimelineEvent";
import { TimelineEventType } from "@/lib/timeline/events";
import { addAuditLog } from "@/lib/audit/addAuditLog";

export type DeriveJobInput = {
  status: JobStatus | string;
  job_id?: string;
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
};

function isActiveJob(status: string) {
  return status !== "cancelled" && status !== "declined";
}

function isWaitingPartStatus(status: string) {
  return status === "needed" || status === "ordered";
}

function jobHasWaitingParts(
  job: DeriveJobInput,
  parts: DerivePartInput[]
): boolean {
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
    activeJobs.length > 0 &&
    activeJobs.every((job) => job.status === "completed");

  if (allActiveCompleted && !qualityCheckComplete) {
    return "quality_check";
  }

  if (allActiveCompleted && qualityCheckComplete) {
    return "ready_for_pickup";
  }

  const allReadyForTechnician =
    activeJobs.length > 0 &&
    activeJobs.every(
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
      "work_order_id, status, location_id, quality_checked_at, quality_checked_by_user_id"
    )
    .eq("work_order_id", workOrderId)
    .single();

  if (woError) throw woError;
  if (!workOrder) throw new Error("WORK_ORDER_NOT_FOUND");

  const { data: jobs, error: jobsError } = await supabase
    .from("job")
    .select("job_id, status")
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

  const nextStatus = deriveWorkOrderStatus({
    currentStatus: workOrder.status,
    jobs: jobs ?? [],
    parts,
    inspectionComplete: Boolean(inspection?.completed_at),
    qualityCheckComplete: Boolean(
      workOrder.quality_checked_at || workOrder.quality_checked_by_user_id
    ),
    hasSignedAgreement: Boolean(agreement),
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

  return nextStatus;
}
