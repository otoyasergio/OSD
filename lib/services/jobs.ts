import { requireUser, type AppUser } from "@/lib/auth/session";
import { createClient } from "@/lib/database/supabase-server";
import type { DbClient, JobStatus } from "@/lib/database/types";
import { addAuditLog } from "@/lib/audit/addAuditLog";
import { addTimelineEvent } from "@/lib/timeline/addTimelineEvent";
import { TimelineEventType } from "@/lib/timeline/events";
import {
  canCompleteJob,
  canCreateWorkOrder,
  canEditWorkOrder,
  canPullJob,
  canRecordCustomerApproval,
  isFloorTech,
} from "@/lib/permissions";
import { addJobSchema, approvalMethodSchema } from "@/lib/validation/schemas";
import { recalculateWorkOrderStatus } from "@/lib/status/recalculateWorkOrderStatus";
import { assertInspectionCompletedForJobFinish } from "@/lib/services/inspectionGate";
import { seedDefaultJobChecklist } from "@/lib/services/jobChecklist";
import { evaluateJobCompleteGate } from "@/lib/status/jobCompleteGate";
import { nextDocketPosition } from "@/lib/technician/docketOrder";
import { isUndefinedColumnError } from "@/lib/database/schemaCompat";

type JobRow = {
  job_id: string;
  work_order_id: string;
  service_id: string;
  service_name_snapshot: string;
  status: JobStatus;
  assigned_technician_id: string | null;
  docket_position: number | null;
  notes: string | null;
  started_at: string | null;
};

type WorkOrderRow = {
  work_order_id: string;
  location_id: string;
  work_order_number: string;
  status: string;
};

async function loadJob(supabase: DbClient, jobId: string): Promise<JobRow | null> {
  const selectWithPosition =
    "job_id, work_order_id, service_id, service_name_snapshot, status, assigned_technician_id, docket_position, notes, started_at";
  const selectWithoutPosition =
    "job_id, work_order_id, service_id, service_name_snapshot, status, assigned_technician_id, notes, started_at";

  let result = await supabase
    .from("job")
    .select(selectWithPosition)
    .eq("job_id", jobId)
    .maybeSingle();
  if (isUndefinedColumnError(result.error, "docket_position")) {
    result = await supabase
      .from("job")
      .select(selectWithoutPosition)
      .eq("job_id", jobId)
      .maybeSingle();
  }
  if (result.error) throw result.error;
  const data = result.data as
    | (Omit<JobRow, "docket_position"> & {
        docket_position?: number | null;
      })
    | null;
  if (!data) return null;
  return { ...data, docket_position: data.docket_position ?? null };
}

async function loadWorkOrder(
  supabase: DbClient,
  workOrderId: string
): Promise<WorkOrderRow | null> {
  const { data, error } = await supabase
    .from("work_order")
    .select("work_order_id, location_id, work_order_number, status")
    .eq("work_order_id", workOrderId)
    .maybeSingle();
  if (error) throw error;
  return (data as WorkOrderRow) ?? null;
}

async function requireMutableWorkOrder(
  user: AppUser,
  workOrderId: string
): Promise<{ supabase: DbClient; workOrder: WorkOrderRow }> {
  const supabase = await createClient();
  const workOrder = await loadWorkOrder(supabase, workOrderId);
  if (!workOrder) throw new Error("WORK_ORDER_NOT_FOUND");
  if (workOrder.location_id !== user.active_location_id) {
    throw new Error("FOREIGN_LOCATION");
  }
  if (workOrder.status === "completed" || workOrder.status === "cancelled") {
    throw new Error("WORK_ORDER_LOCKED");
  }
  return { supabase, workOrder };
}

export async function addJobToWorkOrder(
  workOrderId: string,
  input: { service_id: string; require_approval?: boolean }
): Promise<{ job_id: string }> {
  const user = await requireUser();
  if (!canCreateWorkOrder(user.role) && !canEditWorkOrder(user.role)) {
    throw new Error("FORBIDDEN");
  }

  const parsed = addJobSchema.parse(input);
  const { supabase, workOrder } = await requireMutableWorkOrder(user, workOrderId);

  const { data: service, error: serviceError } = await supabase
    .from("service")
    .select("service_id, name, standard_price, estimated_labour, active")
    .eq("service_id", parsed.service_id)
    .maybeSingle();

  if (serviceError) throw serviceError;
  if (!service || !service.active) throw new Error("SERVICE_NOT_FOUND");

  const status: JobStatus = parsed.require_approval ? "waiting_for_approval" : "approved";

  const { data: job, error } = await supabase
    .from("job")
    .insert({
      work_order_id: workOrderId,
      service_id: service.service_id,
      service_name_snapshot: service.name,
      standard_price_snapshot: service.standard_price,
      estimated_labour_snapshot: service.estimated_labour,
      status,
      created_by_user_id: user.user_id,
      ...(status === "approved"
        ? {
            approved_by_customer_at: new Date().toISOString(),
            approval_method: "in_person",
            approval_recorded_by_user_id: user.user_id,
          }
        : {}),
    })
    .select("job_id, service_name_snapshot")
    .single();

  if (error) throw error;

  await seedDefaultJobChecklist(supabase, job.job_id);

  await addTimelineEvent(supabase, {
    work_order_id: workOrderId,
    user_id: user.user_id,
    event_type: TimelineEventType.JOB_CREATED,
    entity_type: "job",
    entity_id: job.job_id,
    description: `Job created: ${job.service_name_snapshot}`,
    new_value: { status },
  });

  await addAuditLog(supabase, {
    actor_user_id: user.user_id,
    location_id: workOrder.location_id,
    action: "job_created",
    entity_type: "job",
    entity_id: job.job_id,
    description: `Job ${job.service_name_snapshot} added to ${workOrder.work_order_number}`,
    new_value: { status, service_id: service.service_id },
  });

  await recalculateWorkOrderStatus(supabase, workOrderId, user.user_id);

  // New jobs inherit the WO primary tech so they appear on that tech's docket.
  const { data: woTech } = await supabase
    .from("work_order")
    .select("primary_technician_id")
    .eq("work_order_id", workOrderId)
    .maybeSingle();
  if (woTech?.primary_technician_id) {
    await assignTechnicianToJob(job.job_id, woTech.primary_technician_id as string);
  }

  return { job_id: job.job_id };
}

/**
 * Assign every unassigned open job on a work order to a technician so the
 * jobs appear on that tech's floor docket. Jobs already assigned to someone
 * else are left alone.
 */
export async function assignUnassignedJobsOnWorkOrderToTechnician(
  workOrderId: string,
  technicianId: string
): Promise<{ assigned_count: number }> {
  const user = await requireUser();
  if (
    !canEditWorkOrder(user.role) &&
    !canCreateWorkOrder(user.role) &&
    user.role !== "admin"
  ) {
    throw new Error("FORBIDDEN");
  }

  const { supabase } = await requireMutableWorkOrder(user, workOrderId);

  const { data: tech, error: techError } = await supabase
    .from("app_user")
    .select("user_id, role, status")
    .eq("user_id", technicianId)
    .maybeSingle();
  if (techError) throw techError;
  if (!tech || !isFloorTech(tech.role) || tech.status !== "active") {
    throw new Error("TECHNICIAN_NOT_FOUND");
  }

  const { data: jobs, error } = await supabase
    .from("job")
    .select("job_id")
    .eq("work_order_id", workOrderId)
    .is("assigned_technician_id", null)
    .not("status", "in", '("completed","cancelled","declined")')
    .order("created_at", { ascending: true });
  if (error) throw error;

  let assigned_count = 0;
  for (const row of jobs ?? []) {
    await assignTechnicianToJob(row.job_id as string, technicianId);
    assigned_count += 1;
  }

  return { assigned_count };
}

/**
 * Control Center dispatch: assign every active job on a work order to one tech
 * (reassigns jobs already on another tech). Does not touch primary_technician_id.
 */
export async function assignAllActiveJobsOnWorkOrderToTechnician(
  workOrderId: string,
  technicianId: string
): Promise<{ assigned_count: number }> {
  const user = await requireUser();
  if (
    !canEditWorkOrder(user.role) &&
    !canCreateWorkOrder(user.role) &&
    user.role !== "admin"
  ) {
    throw new Error("FORBIDDEN");
  }

  const { supabase } = await requireMutableWorkOrder(user, workOrderId);

  const { data: tech, error: techError } = await supabase
    .from("app_user")
    .select("user_id, role, status")
    .eq("user_id", technicianId)
    .maybeSingle();
  if (techError) throw techError;
  if (!tech || !isFloorTech(tech.role) || tech.status !== "active") {
    throw new Error("TECHNICIAN_NOT_FOUND");
  }

  const { data: jobs, error } = await supabase
    .from("job")
    .select("job_id")
    .eq("work_order_id", workOrderId)
    .not("status", "in", '("completed","cancelled","declined")')
    .order("created_at", { ascending: true });
  if (error) throw error;

  if (!jobs?.length) {
    throw new Error("NO_JOBS_TO_ASSIGN");
  }

  let assigned_count = 0;
  for (const row of jobs) {
    await assignTechnicianToJob(row.job_id as string, technicianId);
    assigned_count += 1;
  }
  return { assigned_count };
}

export async function assignTechnicianToJob(
  jobId: string,
  technicianId: string
): Promise<void> {
  const user = await requireUser();
  if (!canEditWorkOrder(user.role) && user.role !== "admin") {
    throw new Error("FORBIDDEN");
  }

  const supabase = await createClient();
  const job = await loadJob(supabase, jobId);
  if (!job) throw new Error("JOB_NOT_FOUND");

  const { workOrder } = await requireMutableWorkOrder(user, job.work_order_id);

  const { data: tech, error: techError } = await supabase
    .from("app_user")
    .select("user_id, first_name, last_name, role, status")
    .eq("user_id", technicianId)
    .maybeSingle();

  if (techError) throw techError;
  if (!tech || !isFloorTech(tech.role) || tech.status !== "active") {
    throw new Error("TECHNICIAN_NOT_FOUND");
  }

  // New assignments land at the end of the tech's docket; re-saving the same
  // tech keeps the advisor-set position. Skipped when migration 043 is absent.
  let docketPosition: number | null | undefined = job.docket_position;
  let docketColumnAvailable = true;
  if (job.assigned_technician_id !== technicianId || docketPosition == null) {
    const { data: docketRows, error: docketError } = await supabase
      .from("job")
      .select("docket_position")
      .eq("assigned_technician_id", technicianId)
      .not("status", "in", '("completed","cancelled","declined")');
    if (isUndefinedColumnError(docketError, "docket_position")) {
      docketColumnAvailable = false;
      docketPosition = undefined;
    } else {
      if (docketError) throw docketError;
      docketPosition = nextDocketPosition(
        (docketRows ?? []).map(
          (row: { docket_position: number | null }) => row.docket_position
        )
      );
    }
  }

  const updatePayload: Record<string, unknown> = {
    assigned_technician_id: technicianId,
    updated_at: new Date().toISOString(),
  };
  if (docketColumnAvailable && docketPosition != null) {
    updatePayload.docket_position = docketPosition;
  }

  const { error } = await supabase.from("job").update(updatePayload).eq("job_id", jobId);

  if (error) throw error;

  await addTimelineEvent(supabase, {
    work_order_id: job.work_order_id,
    user_id: user.user_id,
    event_type: TimelineEventType.JOB_ASSIGNED,
    entity_type: "job",
    entity_id: jobId,
    description: `Job assigned to ${tech.first_name} ${tech.last_name}`,
    old_value: { assigned_technician_id: job.assigned_technician_id },
    new_value: { assigned_technician_id: technicianId },
  });

  await addAuditLog(supabase, {
    actor_user_id: user.user_id,
    location_id: workOrder.location_id,
    action: "job_assigned",
    entity_type: "job",
    entity_id: jobId,
    description: `Job ${job.service_name_snapshot} assigned`,
    old_value: { assigned_technician_id: job.assigned_technician_id },
    new_value: { assigned_technician_id: technicianId },
  });
}

/**
 * Control Center pool drop: clear technician on every active job for the WO.
 */
export async function unassignAllActiveJobsOnWorkOrder(
  workOrderId: string
): Promise<{ unassigned_count: number }> {
  const user = await requireUser();
  if (
    !canEditWorkOrder(user.role) &&
    !canCreateWorkOrder(user.role) &&
    user.role !== "admin"
  ) {
    throw new Error("FORBIDDEN");
  }

  const { supabase, workOrder } = await requireMutableWorkOrder(user, workOrderId);

  const { data: jobs, error } = await supabase
    .from("job")
    .select("job_id, assigned_technician_id, service_name_snapshot")
    .eq("work_order_id", workOrderId)
    .not("status", "in", '("completed","cancelled","declined")')
    .not("assigned_technician_id", "is", null);
  if (error) throw error;

  let unassigned_count = 0;
  const now = new Date().toISOString();
  for (const job of jobs ?? []) {
    const { error: updateError } = await supabase
      .from("job")
      .update({
        assigned_technician_id: null,
        docket_position: null,
        updated_at: now,
      })
      .eq("job_id", job.job_id);
    if (isUndefinedColumnError(updateError, "docket_position")) {
      const { error: retryError } = await supabase
        .from("job")
        .update({
          assigned_technician_id: null,
          updated_at: now,
        })
        .eq("job_id", job.job_id);
      if (retryError) throw retryError;
    } else if (updateError) {
      throw updateError;
    }

    await addTimelineEvent(supabase, {
      work_order_id: workOrderId,
      user_id: user.user_id,
      event_type: TimelineEventType.JOB_ASSIGNED,
      entity_type: "job",
      entity_id: job.job_id,
      description: `Job unassigned (${job.service_name_snapshot})`,
      old_value: { assigned_technician_id: job.assigned_technician_id },
      new_value: { assigned_technician_id: null },
    });

    await addAuditLog(supabase, {
      actor_user_id: user.user_id,
      location_id: workOrder.location_id,
      action: "job_unassigned",
      entity_type: "job",
      entity_id: job.job_id,
      description: `Job ${job.service_name_snapshot} unassigned`,
      old_value: { assigned_technician_id: job.assigned_technician_id },
      new_value: { assigned_technician_id: null },
    });

    unassigned_count += 1;
  }

  return { unassigned_count };
}

/** Sets work_order.opened_at once (idempotent if already set). */
export async function openWorkOrderForControlCenter(
  workOrderId: string
): Promise<{ opened_at: string }> {
  const user = await requireUser();
  if (
    !canEditWorkOrder(user.role) &&
    !canCreateWorkOrder(user.role) &&
    user.role !== "admin"
  ) {
    throw new Error("FORBIDDEN");
  }

  const { supabase, workOrder } = await requireMutableWorkOrder(user, workOrderId);

  const { data: current, error: readError } = await supabase
    .from("work_order")
    .select("opened_at")
    .eq("work_order_id", workOrderId)
    .maybeSingle();
  if (isUndefinedColumnError(readError, "opened_at")) {
    throw new Error("OPENED_AT_UNAVAILABLE");
  }
  if (readError) throw readError;

  if (current?.opened_at) {
    return { opened_at: current.opened_at as string };
  }

  const opened_at = new Date().toISOString();
  const { error } = await supabase
    .from("work_order")
    .update({ opened_at })
    .eq("work_order_id", workOrderId);
  if (isUndefinedColumnError(error, "opened_at")) {
    throw new Error("OPENED_AT_UNAVAILABLE");
  }
  if (error) throw error;

  await addAuditLog(supabase, {
    actor_user_id: user.user_id,
    location_id: workOrder.location_id,
    action: "work_order_opened",
    entity_type: "work_order",
    entity_id: workOrderId,
    description: "Work order opened on Control Center",
    new_value: { opened_at },
  });

  return { opened_at };
}

export async function pullJob(
  jobId: string,
  options: { andStart?: boolean } = {}
): Promise<void> {
  const user = await requireUser();
  if (!canPullJob(user.role)) throw new Error("FORBIDDEN");
  if (!isFloorTech(user.role)) {
    throw new Error("FORBIDDEN");
  }

  const supabase = await createClient();
  const job = await loadJob(supabase, jobId);
  if (!job) throw new Error("JOB_NOT_FOUND");

  const { workOrder } = await requireMutableWorkOrder(user, job.work_order_id);

  if (job.status !== "approved" && job.status !== "ready_to_start") {
    throw new Error("JOB_NOT_READY");
  }
  if (job.assigned_technician_id) {
    throw new Error("JOB_ALREADY_ASSIGNED");
  }

  if (
    workOrder.status === "on_hold" ||
    workOrder.status === "waiting_for_parts" ||
    workOrder.status === "waiting_for_customer_approval" ||
    workOrder.status === "cancelled" ||
    workOrder.status === "completed"
  ) {
    throw new Error("JOB_NOT_READY");
  }

  if (workOrder.status !== "ready_for_technician" && workOrder.status !== "in_progress") {
    throw new Error("JOB_NOT_READY");
  }

  if (options.andStart) {
    const { data: otherActive, error: activeError } = await supabase
      .from("job")
      .select("job_id")
      .eq("assigned_technician_id", user.user_id)
      .eq("status", "in_progress")
      .limit(1);
    if (activeError) throw activeError;
    if ((otherActive ?? []).length > 0) {
      throw new Error("OTHER_JOB_IN_PROGRESS");
    }
  }

  const now = new Date().toISOString();
  const { error } = await supabase
    .from("job")
    .update({
      assigned_technician_id: user.user_id,
      ...(options.andStart ? { status: "in_progress", started_at: now } : {}),
      updated_at: now,
    })
    .eq("job_id", jobId)
    .is("assigned_technician_id", null);
  if (error) throw error;

  await addTimelineEvent(supabase, {
    work_order_id: job.work_order_id,
    user_id: user.user_id,
    event_type: TimelineEventType.JOB_ASSIGNED,
    entity_type: "job",
    entity_id: jobId,
    description: options.andStart
      ? `Job pulled and started by technician`
      : `Job pulled by technician`,
    old_value: { assigned_technician_id: null },
    new_value: {
      assigned_technician_id: user.user_id,
      ...(options.andStart ? { status: "in_progress" } : {}),
    },
  });

  await addAuditLog(supabase, {
    actor_user_id: user.user_id,
    location_id: workOrder.location_id,
    action: options.andStart ? "job_pulled_and_started" : "job_pulled",
    entity_type: "job",
    entity_id: jobId,
    description: `Job ${job.service_name_snapshot} pulled`,
    new_value: { assigned_technician_id: user.user_id },
  });

  if (options.andStart) {
    await recalculateWorkOrderStatus(supabase, job.work_order_id, user.user_id);
    if (isFloorTech(user.role)) {
      const { startJobTime } = await import("@/lib/services/jobTimeClock");
      await startJobTime(jobId);
    }
  }
}

function assertStatusTransition(
  user: AppUser,
  job: JobRow,
  nextStatus: JobStatus,
  note?: string | null
) {
  if (nextStatus === "in_progress") {
    if (job.status !== "approved" && job.status !== "ready_to_start") {
      throw new Error("JOB_NOT_READY");
    }
    if (isFloorTech(user.role) && job.assigned_technician_id !== user.user_id) {
      throw new Error("JOB_NOT_ASSIGNED_TO_YOU");
    }
    if (!canCompleteJob(user.role)) throw new Error("FORBIDDEN");
  }

  if (nextStatus === "completed") {
    if (!job.assigned_technician_id) throw new Error("JOB_NOT_ASSIGNED");
    if (isFloorTech(user.role) && job.assigned_technician_id !== user.user_id) {
      throw new Error("JOB_NOT_ASSIGNED_TO_YOU");
    }
    if (!canCompleteJob(user.role)) throw new Error("FORBIDDEN");
  }

  if (nextStatus === "cancelled") {
    if (!canEditWorkOrder(user.role)) throw new Error("FORBIDDEN");
    if (!note?.trim()) throw new Error("CANCEL_NOTE_REQUIRED");
  }

  if (nextStatus === "ready_to_start" || nextStatus === "waiting_for_parts") {
    if (!canEditWorkOrder(user.role) && !isFloorTech(user.role)) {
      throw new Error("FORBIDDEN");
    }
  }
}

export async function updateJobStatus(
  jobId: string,
  nextStatus: JobStatus,
  options: { note?: string | null } = {}
): Promise<void> {
  const user = await requireUser();
  const supabase = await createClient();
  const job = await loadJob(supabase, jobId);
  if (!job) throw new Error("JOB_NOT_FOUND");

  const { workOrder } = await requireMutableWorkOrder(user, job.work_order_id);
  assertStatusTransition(user, job, nextStatus, options.note);

  if (nextStatus === "in_progress") {
    const { data: otherActive, error: activeError } = await supabase
      .from("job")
      .select("job_id")
      .eq("assigned_technician_id", user.user_id)
      .eq("status", "in_progress")
      .neq("job_id", jobId)
      .limit(1);
    if (activeError) throw activeError;
    if ((otherActive ?? []).length > 0) {
      throw new Error("OTHER_JOB_IN_PROGRESS");
    }
  }

  if (nextStatus === "completed") {
    const { data: inspection, error: inspectionError } = await supabase
      .from("inspection")
      .select("completed_at")
      .eq("work_order_id", job.work_order_id)
      .maybeSingle();
    if (inspectionError) throw inspectionError;
    try {
      assertInspectionCompletedForJobFinish(inspection?.completed_at);
    } catch (error) {
      if (error instanceof Error && error.message === "INSPECTION_NOT_COMPLETED") {
        await addAuditLog(supabase, {
          actor_user_id: user.user_id,
          location_id: workOrder.location_id,
          action: "job_complete_blocked_inspection",
          entity_type: "job",
          entity_id: jobId,
          description: "Complete the inspection report before finishing jobs.",
          new_value: { attempted_status: "completed" },
        });
      }
      throw error;
    }

    const [{ data: checklist }, { data: parts }, { data: proofs }, { data: exceptions }] =
      await Promise.all([
        supabase.from("job_checklist_item").select("checked_at").eq("job_id", jobId),
        supabase.from("part").select("status").eq("job_id", jobId),
        supabase
          .from("intake_photo")
          .select("photo_id")
          .eq("job_id", jobId)
          .eq("category", "job_proof"),
        supabase
          .from("technician_note")
          .select("technician_note_id")
          .eq("job_id", jobId)
          .eq("note_type", "proof_exception")
          .limit(1),
      ]);

    const gate = evaluateJobCompleteGate({
      checklistItems: (checklist as Array<{ checked_at: string | null }>) ?? [],
      parts: (parts as Array<{ status: string }>) ?? [],
      proofPhotoCount: (proofs ?? []).length,
      hasProofException: (exceptions ?? []).length > 0,
      inspectionComplete: Boolean(inspection?.completed_at),
    });
    if (!gate.ok) {
      throw new Error(gate.code);
    }
  }

  const updates: Record<string, unknown> = {
    status: nextStatus,
    updated_at: new Date().toISOString(),
  };

  if (nextStatus === "in_progress" && !job.started_at) {
    updates.started_at = new Date().toISOString();
  }
  if (nextStatus === "completed") {
    updates.completed_at = new Date().toISOString();
  }
  if (nextStatus === "cancelled" && options.note) {
    updates.notes = [job.notes, `Cancelled: ${options.note.trim()}`]
      .filter(Boolean)
      .join("\n");
  }

  const { error } = await supabase.from("job").update(updates).eq("job_id", jobId);
  if (error) throw error;

  if (nextStatus === "in_progress" && isFloorTech(user.role)) {
    const { switchJobTime } = await import("@/lib/services/jobTimeClock");
    await switchJobTime(jobId);
  }
  if (
    (nextStatus === "completed" || nextStatus === "cancelled") &&
    isFloorTech(user.role)
  ) {
    const { endOpenJobTime } = await import("@/lib/services/jobTimeClock");
    await endOpenJobTime({ jobId }).catch(() => null);
  }

  await addTimelineEvent(supabase, {
    work_order_id: job.work_order_id,
    user_id: user.user_id,
    event_type: TimelineEventType.JOB_STATUS_CHANGED,
    entity_type: "job",
    entity_id: jobId,
    description: `Job status changed to ${nextStatus}`,
    old_value: { status: job.status },
    new_value: { status: nextStatus },
  });

  await addAuditLog(supabase, {
    actor_user_id: user.user_id,
    location_id: workOrder.location_id,
    action: "job_status_changed",
    entity_type: "job",
    entity_id: jobId,
    description: `Job ${job.service_name_snapshot} → ${nextStatus}`,
    old_value: { status: job.status },
    new_value: { status: nextStatus, note: options.note ?? null },
  });

  await recalculateWorkOrderStatus(supabase, job.work_order_id, user.user_id);
}

export async function recordCustomerApproval(
  jobId: string,
  approvalMethod: string
): Promise<void> {
  const user = await requireUser();
  if (!canRecordCustomerApproval(user.role)) throw new Error("FORBIDDEN");

  const method = approvalMethodSchema.parse(approvalMethod);
  const supabase = await createClient();
  const job = await loadJob(supabase, jobId);
  if (!job) throw new Error("JOB_NOT_FOUND");

  const { workOrder } = await requireMutableWorkOrder(user, job.work_order_id);

  if (
    job.status !== "waiting_for_approval" &&
    job.status !== "draft" &&
    job.status !== "declined"
  ) {
    throw new Error("JOB_NOT_AWAITING_APPROVAL");
  }

  const approvedAt = new Date().toISOString();
  const { error } = await supabase
    .from("job")
    .update({
      status: "approved",
      approved_by_customer_at: approvedAt,
      approval_method: method,
      approval_recorded_by_user_id: user.user_id,
      declined_at: null,
      decline_reason: null,
      updated_at: approvedAt,
    })
    .eq("job_id", jobId);

  if (error) throw error;

  await addTimelineEvent(supabase, {
    work_order_id: job.work_order_id,
    user_id: user.user_id,
    event_type: TimelineEventType.CUSTOMER_APPROVAL_RECORDED,
    entity_type: "job",
    entity_id: jobId,
    description: `Customer approval recorded (${method})`,
    old_value: { status: job.status },
    new_value: { status: "approved", approval_method: method },
  });

  await addAuditLog(supabase, {
    actor_user_id: user.user_id,
    location_id: workOrder.location_id,
    action: "customer_approval_recorded",
    entity_type: "job",
    entity_id: jobId,
    description: `Approval recorded for ${job.service_name_snapshot}`,
    old_value: { status: job.status },
    new_value: { status: "approved", approval_method: method },
  });

  await recalculateWorkOrderStatus(supabase, job.work_order_id, user.user_id);
}

export async function recordCustomerDecline(
  jobId: string,
  declineReason: string
): Promise<void> {
  const user = await requireUser();
  if (!canRecordCustomerApproval(user.role)) throw new Error("FORBIDDEN");

  const reason = declineReason.trim();
  if (!reason) throw new Error("DECLINE_REASON_REQUIRED");

  const supabase = await createClient();
  const job = await loadJob(supabase, jobId);
  if (!job) throw new Error("JOB_NOT_FOUND");

  const { workOrder } = await requireMutableWorkOrder(user, job.work_order_id);

  if (
    job.status !== "waiting_for_approval" &&
    job.status !== "draft" &&
    job.status !== "approved"
  ) {
    throw new Error("JOB_CANNOT_DECLINE");
  }

  const declinedAt = new Date().toISOString();
  const { error } = await supabase
    .from("job")
    .update({
      status: "declined",
      declined_at: declinedAt,
      decline_reason: reason,
      updated_at: declinedAt,
    })
    .eq("job_id", jobId);

  if (error) throw error;

  await addTimelineEvent(supabase, {
    work_order_id: job.work_order_id,
    user_id: user.user_id,
    event_type: TimelineEventType.CUSTOMER_DECLINE_RECORDED,
    entity_type: "job",
    entity_id: jobId,
    description: `Customer decline recorded: ${reason}`,
    old_value: { status: job.status },
    new_value: { status: "declined", decline_reason: reason },
  });

  await addAuditLog(supabase, {
    actor_user_id: user.user_id,
    location_id: workOrder.location_id,
    action: "customer_decline_recorded",
    entity_type: "job",
    entity_id: jobId,
    description: `Decline recorded for ${job.service_name_snapshot}`,
    old_value: { status: job.status },
    new_value: { status: "declined", decline_reason: reason },
  });

  await recalculateWorkOrderStatus(supabase, job.work_order_id, user.user_id);
}
