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

type JobRow = {
  job_id: string;
  work_order_id: string;
  service_id: string;
  service_name_snapshot: string;
  status: JobStatus;
  assigned_technician_id: string | null;
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
  const { data, error } = await supabase
    .from("job")
    .select(
      "job_id, work_order_id, service_id, service_name_snapshot, status, assigned_technician_id, notes, started_at"
    )
    .eq("job_id", jobId)
    .maybeSingle();
  if (error) throw error;
  return (data as JobRow) ?? null;
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
  return { job_id: job.job_id };
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

  const { error } = await supabase
    .from("job")
    .update({
      assigned_technician_id: technicianId,
      updated_at: new Date().toISOString(),
    })
    .eq("job_id", jobId);

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

  const { data: agreement, error: agreementError } = await supabase
    .from("drop_off_agreement")
    .select("agreement_id")
    .eq("work_order_id", job.work_order_id)
    .maybeSingle();
  if (agreementError) throw agreementError;
  if (!agreement) throw new Error("CONTRACT_REQUIRED");

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
