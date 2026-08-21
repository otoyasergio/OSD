import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/database/supabase-server";
import { createAdminClient } from "@/lib/database/supabase-admin";
import type { DbClient } from "@/lib/database/types";
import { addAuditLog } from "@/lib/audit/addAuditLog";
import { addTimelineEvent } from "@/lib/timeline/addTimelineEvent";
import { TimelineEventType } from "@/lib/timeline/events";
import {
  canCompleteJob,
  canPerformPeerQualityCheck,
  canRunQualityCheck,
} from "@/lib/permissions";
import { readWorkflowV2Flags, v2WritesEnabled } from "@/lib/config/features";
import { computeQcScopeHash } from "@/lib/jobs-v2/scopeHash";
import {
  buildLegacyReworkJobUpdate,
  collectVisitWorkerIds,
  filterEligibleQcCandidates,
} from "@/lib/jobs-v2/peerQcCompletion";
import { pickPeerQcAssignee } from "@/lib/status/peerQcAssigner";
import { recalculateWorkOrderStatus } from "@/lib/status/recalculateWorkOrderStatus";
import { createAdminFlag } from "@/lib/services/adminFlags";
import { toRpcErrorCode } from "@/lib/services/errors";
import { completeQualityCheck } from "@/lib/services/quality";

export type PeerQcPickerOption = {
  user_id: string;
  display_name: string;
};

async function listClockedInTechnicians(
  supabase: DbClient,
  locationId: string
): Promise<Array<{ user_id: string; first_name: string; last_name: string }>> {
  const { data: punches, error } = await supabase
    .from("time_clock_entry")
    .select("user_id")
    .eq("location_id", locationId)
    .is("clock_out_at", null);
  if (error) throw error;

  const userIds = [
    ...new Set((punches ?? []).map((row: { user_id: string }) => row.user_id)),
  ];
  if (userIds.length === 0) return [];

  const { data: techs, error: techError } = await supabase
    .from("app_user")
    .select("user_id, first_name, last_name")
    .in("user_id", userIds)
    .in("role", ["technician", "head_tech"])
    .eq("status", "active");
  if (techError) throw techError;
  return (techs ?? []) as Array<{
    user_id: string;
    first_name: string;
    last_name: string;
  }>;
}

async function listClockedInTechnicianIds(
  supabase: DbClient,
  locationId: string
): Promise<string[]> {
  const techs = await listClockedInTechnicians(supabase, locationId);
  return techs.map((row) => row.user_id);
}

/**
 * Every user who worked ANY job on the visit — assigned technicians plus
 * job_time_entry contributors. None of them may peer-QC the visit.
 */
async function listVisitWorkerIds(
  supabase: DbClient,
  workOrderId: string
): Promise<Set<string>> {
  const { data: jobs, error: jobsError } = await supabase
    .from("job")
    .select("job_id, status, assigned_technician_id")
    .eq("work_order_id", workOrderId);
  if (jobsError) throw jobsError;

  const jobRows = (jobs ?? []) as Array<{
    job_id: string;
    status: string;
    assigned_technician_id: string | null;
  }>;

  let timeEntries: Array<{ job_id: string; user_id: string }> = [];
  const jobIds = jobRows.map((job) => job.job_id);
  if (jobIds.length > 0) {
    const { data: entries, error: entriesError } = await supabase
      .from("job_time_entry")
      .select("job_id, user_id")
      .in("job_id", jobIds);
    if (entriesError) throw entriesError;
    timeEntries = (entries ?? []) as Array<{ job_id: string; user_id: string }>;
  }

  return collectVisitWorkerIds(jobRows, timeEntries);
}

/**
 * Clocked-in peers a tech can ask to check their work. Excludes the asking
 * tech and — when the work order is known — EVERYONE who worked any job on
 * that visit (assigned or logged time), not just the finisher.
 */
export async function listPeerQcPickerOptions(
  excludeUserId: string,
  workOrderId?: string | null
): Promise<PeerQcPickerOption[]> {
  const user = await requireUser();
  const supabase = await createClient();
  const locationId = user.active_location_id!;
  const techs = await listClockedInTechnicians(supabase, locationId);
  const workedUserIds = workOrderId
    ? await listVisitWorkerIds(supabase, workOrderId)
    : new Set<string>();
  return filterEligibleQcCandidates(techs, workedUserIds, excludeUserId)
    .map((tech) => ({
      user_id: tech.user_id,
      display_name: `${tech.first_name} ${tech.last_name}`.trim() || "Technician",
    }))
    .sort((a, b) => a.display_name.localeCompare(b.display_name));
}

/** Tech-chosen peer QC assignee after finishing a job. */
export async function assignPeerQcByTechnician(
  workOrderId: string,
  assigneeUserId: string
): Promise<void> {
  const user = await requireUser();
  if (!canCompleteJob(user.role)) throw new Error("FORBIDDEN");
  const supabase = await createClient();
  const locationId = user.active_location_id!;

  if (!assigneeUserId || assigneeUserId === user.user_id) {
    throw new Error("QC_ASSIGNEE_REQUIRED");
  }

  const { data: workOrder, error } = await supabase
    .from("work_order")
    .select("work_order_id, location_id, status, work_order_number")
    .eq("work_order_id", workOrderId)
    .maybeSingle();
  if (error) throw error;
  if (!workOrder) throw new Error("WORK_ORDER_NOT_FOUND");
  if (workOrder.location_id !== locationId) throw new Error("FOREIGN_LOCATION");

  const clockedIn = await listClockedInTechnicianIds(supabase, locationId);
  if (!clockedIn.includes(assigneeUserId)) {
    throw new Error("QC_ASSIGNEE_NOT_AVAILABLE");
  }

  // The candidate must not have touched the visit — neither assigned to a
  // job nor a job_time_entry contributor (same rule the V2 command enforces).
  const workedUserIds = await listVisitWorkerIds(supabase, workOrderId);
  if (workedUserIds.has(assigneeUserId)) {
    throw new Error("QC_CANDIDATE_WORKED_ON_VISIT");
  }

  const { data: assignee, error: assigneeError } = await supabase
    .from("app_user")
    .select("user_id, role, status, first_name, last_name")
    .eq("user_id", assigneeUserId)
    .maybeSingle();
  if (assigneeError) throw assigneeError;
  if (
    !assignee ||
    assignee.status !== "active" ||
    !["technician", "head_tech"].includes(assignee.role)
  ) {
    throw new Error("QC_ASSIGNEE_NOT_AVAILABLE");
  }

  const { error: updateError } = await supabase
    .from("work_order")
    .update({
      quality_check_assigned_to: assigneeUserId,
      updated_at: new Date().toISOString(),
    })
    .eq("work_order_id", workOrderId);
  if (updateError) throw updateError;

  const name = `${assignee.first_name} ${assignee.last_name}`.trim();
  await addTimelineEvent(supabase, {
    work_order_id: workOrderId,
    user_id: user.user_id,
    event_type: TimelineEventType.WORK_ORDER_STATUS_CHANGED,
    entity_type: "work_order",
    entity_id: workOrderId,
    description: `Peer QC assigned to ${name || "technician"}`,
    new_value: { quality_check_assigned_to: assigneeUserId, chosen_by: user.user_id },
  });

  await addAuditLog(supabase, {
    actor_user_id: user.user_id,
    location_id: locationId,
    action: "peer_qc_assigned",
    entity_type: "work_order",
    entity_id: workOrderId,
    description: `Peer QC chosen by finishing tech → ${name || assigneeUserId}`,
    new_value: { quality_check_assigned_to: assigneeUserId },
  });
}

const UNASSIGNED_QC_NOTE =
  "No peer QC assignee available — no eligible clocked-in technician.";

async function flagUnassignedPeerQc(
  supabase: DbClient,
  workOrderId: string,
  locationId: string,
  actorUserId: string | null
): Promise<void> {
  const { data: existing, error: existingError } = await supabase
    .from("admin_flag")
    .select("admin_flag_id")
    .eq("work_order_id", workOrderId)
    .eq("reason", "quality")
    .is("cleared_at", null)
    .eq("note", UNASSIGNED_QC_NOTE)
    .limit(1);
  if (existingError) throw existingError;
  if ((existing ?? []).length > 0) return;

  const { error: insertError } = await supabase.from("admin_flag").insert({
    work_order_id: workOrderId,
    reason: "quality",
    note: UNASSIGNED_QC_NOTE,
    created_by_user_id: actorUserId,
  });
  if (insertError) throw insertError;

  await addTimelineEvent(supabase, {
    work_order_id: workOrderId,
    user_id: actorUserId,
    event_type: TimelineEventType.WORK_ORDER_STATUS_CHANGED,
    entity_type: "work_order",
    entity_id: workOrderId,
    description: "Peer QC unassigned — admin flag raised",
    new_value: { quality_check_assigned_to: null, andon: true },
  });

  await addAuditLog(supabase, {
    actor_user_id: actorUserId,
    location_id: locationId,
    action: "peer_qc_unassigned_flag",
    entity_type: "work_order",
    entity_id: workOrderId,
    description: UNASSIGNED_QC_NOTE,
  });
}

export async function autoAssignPeerQc(
  supabase: DbClient,
  workOrderId: string,
  locationId: string,
  actorUserId: string | null
): Promise<string | null> {
  const { data: wo, error: woError } = await supabase
    .from("work_order")
    .select("quality_check_assigned_to, status")
    .eq("work_order_id", workOrderId)
    .maybeSingle();
  if (woError) throw woError;
  if (!wo || wo.status !== "quality_check") return null;
  if (wo.quality_check_assigned_to) return wo.quality_check_assigned_to;

  const { data: jobs, error: jobsError } = await supabase
    .from("job")
    .select("assigned_technician_id, status")
    .eq("work_order_id", workOrderId);
  if (jobsError) throw jobsError;

  const workerUserIds = [
    ...new Set(
      (jobs ?? [])
        .filter(
          (job: { status: string; assigned_technician_id: string | null }) =>
            job.status === "completed" && job.assigned_technician_id
        )
        .map(
          (job: { assigned_technician_id: string | null }) =>
            job.assigned_technician_id as string
        )
    ),
  ];

  const clockedIn = await listClockedInTechnicianIds(supabase, locationId);
  if (clockedIn.length === 0) {
    await flagUnassignedPeerQc(supabase, workOrderId, locationId, actorUserId);
    return null;
  }

  const { data: openJobs, error: openJobsError } = await supabase
    .from("job")
    .select("assigned_technician_id")
    .in("assigned_technician_id", clockedIn)
    .in("status", ["in_progress", "ready_to_start", "approved"]);
  if (openJobsError) throw openJobsError;

  const { data: openQc, error: openQcError } = await supabase
    .from("work_order")
    .select("quality_check_assigned_to")
    .eq("location_id", locationId)
    .eq("status", "quality_check")
    .in("quality_check_assigned_to", clockedIn);
  if (openQcError) throw openQcError;

  const jobCounts = new Map<string, number>();
  const qcCounts = new Map<string, number>();
  for (const id of clockedIn) {
    jobCounts.set(id, 0);
    qcCounts.set(id, 0);
  }
  for (const row of openJobs ?? []) {
    const id = (row as { assigned_technician_id: string | null }).assigned_technician_id;
    if (id) jobCounts.set(id, (jobCounts.get(id) ?? 0) + 1);
  }
  for (const row of openQc ?? []) {
    const id = (row as { quality_check_assigned_to: string | null })
      .quality_check_assigned_to;
    if (id) qcCounts.set(id, (qcCounts.get(id) ?? 0) + 1);
  }

  const assignee = pickPeerQcAssignee({
    workerUserIds,
    candidates: clockedIn.map((userId) => ({
      userId,
      openJobCount: jobCounts.get(userId) ?? 0,
      openQcCount: qcCounts.get(userId) ?? 0,
    })),
  });

  if (!assignee) {
    await flagUnassignedPeerQc(supabase, workOrderId, locationId, actorUserId);
    return null;
  }

  const { error: updateError } = await supabase
    .from("work_order")
    .update({
      quality_check_assigned_to: assignee,
      updated_at: new Date().toISOString(),
    })
    .eq("work_order_id", workOrderId);
  if (updateError) throw updateError;

  await addTimelineEvent(supabase, {
    work_order_id: workOrderId,
    user_id: actorUserId,
    event_type: TimelineEventType.WORK_ORDER_STATUS_CHANGED,
    entity_type: "work_order",
    entity_id: workOrderId,
    description: "Peer QC auto-assigned",
    new_value: { quality_check_assigned_to: assignee },
  });

  await addAuditLog(supabase, {
    actor_user_id: actorUserId,
    location_id: locationId,
    action: "peer_qc_assigned",
    entity_type: "work_order",
    entity_id: workOrderId,
    description: "Peer QC auto-assigned",
    new_value: { quality_check_assigned_to: assignee },
  });

  return assignee;
}

/**
 * V2: record an immutable QC attempt against the exact scope of currently
 * completed jobs. The command validates the performer, stamps/clears
 * quality fields, reopens rework jobs (keeping their original completion
 * timestamps), and appends the domain event — all in one transaction.
 */
async function recordQcAttemptV2(input: {
  workOrderId: string;
  actorUserId: string;
  outcome: "passed" | "failed";
  notes: string | null;
  reworkJobIds?: string[] | null;
}): Promise<void> {
  const admin = createAdminClient();
  const { data: completedJobs, error } = await admin
    .from("job")
    .select("job_id, completed_at")
    .eq("work_order_id", input.workOrderId)
    .eq("status", "completed");
  if (error) throw error;

  const scopeHash = computeQcScopeHash(
    (completedJobs ?? []).map((job) => ({
      jobId: job.job_id as string,
      completedAt: (job.completed_at as string | null) ?? null,
    }))
  );

  const { error: rpcError } = await admin.rpc("workflow_v2_record_qc_attempt", {
    p_work_order_id: input.workOrderId,
    p_actor_user_id: input.actorUserId,
    p_outcome: input.outcome,
    p_scope_hash: scopeHash,
    p_notes: input.notes,
    p_checklist: null,
    p_rework_job_ids: input.reworkJobIds ?? null,
    p_idempotency_key: `qc:${input.workOrderId}:${input.outcome}:${scopeHash}`,
  });
  if (rpcError) throw new Error(toRpcErrorCode(rpcError));
}

export async function passPeerQualityCheck(
  workOrderId: string,
  notes?: string | null
): Promise<void> {
  const user = await requireUser();
  if (!canPerformPeerQualityCheck(user.role)) throw new Error("FORBIDDEN");

  const supabase = await createClient();
  const { data: workOrder, error } = await supabase
    .from("work_order")
    .select("work_order_id, location_id, status, quality_check_assigned_to")
    .eq("work_order_id", workOrderId)
    .maybeSingle();
  if (error) throw error;
  if (!workOrder) throw new Error("WORK_ORDER_NOT_FOUND");
  if (workOrder.location_id !== user.active_location_id) {
    throw new Error("FOREIGN_LOCATION");
  }

  const useV2 = v2WritesEnabled(readWorkflowV2Flags());
  const isFrontOffice = canRunQualityCheck(user.role);

  if (!isFrontOffice) {
    if (workOrder.quality_check_assigned_to !== user.user_id) {
      throw new Error("QC_NOT_ASSIGNED_TO_YOU");
    }
    if (workOrder.status !== "quality_check") {
      throw new Error("INVALID_STATUS");
    }

    const { data: jobs, error: jobsError } = await supabase
      .from("job")
      .select("assigned_technician_id, status")
      .eq("work_order_id", workOrderId);
    if (jobsError) throw jobsError;
    const worked = (jobs ?? []).some(
      (job: { assigned_technician_id: string | null; status: string }) =>
        job.status === "completed" && job.assigned_technician_id === user.user_id
    );
    if (worked) throw new Error("CANNOT_QC_OWN_WORK");
  }

  if (useV2) {
    // Legacy parity: terminal work orders reject QC writes.
    if (workOrder.status === "completed" || workOrder.status === "cancelled") {
      throw new Error("WORK_ORDER_LOCKED");
    }

    // Same gate the legacy completeQualityCheck enforces: nothing passes QC
    // while active work remains open.
    const { data: gateJobs, error: gateError } = await supabase
      .from("job")
      .select("status")
      .eq("work_order_id", workOrderId);
    if (gateError) throw gateError;
    const activeJobs = (gateJobs ?? []).filter(
      (job: { status: string }) => job.status !== "cancelled" && job.status !== "declined"
    );
    if (activeJobs.length === 0) throw new Error("NO_ACTIVE_JOBS");
    if (activeJobs.some((job: { status: string }) => job.status !== "completed")) {
      throw new Error("JOBS_NOT_COMPLETE");
    }

    const trimmedNotes = notes?.trim() || null;
    await recordQcAttemptV2({
      workOrderId,
      actorUserId: user.user_id,
      outcome: "passed",
      notes: trimmedNotes,
    });

    await addTimelineEvent(supabase, {
      work_order_id: workOrderId,
      user_id: user.user_id,
      event_type: TimelineEventType.QUALITY_CHECK_COMPLETED,
      entity_type: "work_order",
      entity_id: workOrderId,
      description: "Quality check completed",
      new_value: { quality_check_notes: trimmedNotes },
    });
    await addAuditLog(supabase, {
      actor_user_id: user.user_id,
      location_id: workOrder.location_id,
      action: "quality_check_completed",
      entity_type: "work_order",
      entity_id: workOrderId,
      description: "Quality check completed",
      new_value: { quality_check_notes: trimmedNotes },
    });
    await recalculateWorkOrderStatus(supabase, workOrderId, user.user_id);
    return;
  }

  if (isFrontOffice) {
    await completeQualityCheck(workOrderId, notes);
    return;
  }

  await completeQualityCheck(workOrderId, notes, { allowPeerTechnician: true });
}

export async function failPeerQualityCheck(
  workOrderId: string,
  reason: string
): Promise<void> {
  const user = await requireUser();
  if (!canPerformPeerQualityCheck(user.role)) throw new Error("FORBIDDEN");

  const trimmed = reason.trim();
  if (!trimmed) throw new Error("QC_FAIL_REASON_REQUIRED");

  const supabase = await createClient();
  const { data: workOrder, error } = await supabase
    .from("work_order")
    .select(
      "work_order_id, location_id, status, quality_check_assigned_to, work_order_number"
    )
    .eq("work_order_id", workOrderId)
    .maybeSingle();
  if (error) throw error;
  if (!workOrder) throw new Error("WORK_ORDER_NOT_FOUND");
  if (workOrder.location_id !== user.active_location_id) {
    throw new Error("FOREIGN_LOCATION");
  }
  if (workOrder.status !== "quality_check") {
    throw new Error("INVALID_STATUS");
  }

  const isFrontOffice = canRunQualityCheck(user.role);
  if (!isFrontOffice && workOrder.quality_check_assigned_to !== user.user_id) {
    throw new Error("QC_NOT_ASSIGNED_TO_YOU");
  }

  const { data: jobs, error: jobsError } = await supabase
    .from("job")
    .select("job_id, assigned_technician_id, status")
    .eq("work_order_id", workOrderId);
  if (jobsError) throw jobsError;

  if (!isFrontOffice) {
    const worked = (jobs ?? []).some(
      (job: { assigned_technician_id: string | null; status: string }) =>
        job.status === "completed" && job.assigned_technician_id === user.user_id
    );
    if (worked) throw new Error("CANNOT_QC_OWN_WORK");
  }

  const now = new Date().toISOString();
  const completedJobs = (jobs ?? []).filter(
    (job: { status: string }) => job.status === "completed"
  );

  if (v2WritesEnabled(readWorkflowV2Flags())) {
    // One transaction: immutable failed attempt + targeted rework reopen
    // (original completion timestamps preserved) + quality fields cleared.
    await recordQcAttemptV2({
      workOrderId,
      actorUserId: user.user_id,
      outcome: "failed",
      notes: trimmed,
      reworkJobIds: completedJobs.map((job) => (job as { job_id: string }).job_id),
    });
  } else {
    // Rework reopens jobs WITHOUT erasing when they were originally
    // started/completed — that history is evidence for the fail record.
    for (const job of completedJobs) {
      const { error: jobError } = await supabase
        .from("job")
        .update(buildLegacyReworkJobUpdate(now))
        .eq("job_id", (job as { job_id: string }).job_id);
      if (jobError) throw jobError;
    }

    const { error: woError } = await supabase
      .from("work_order")
      .update({
        quality_checked_at: null,
        quality_checked_by_user_id: null,
        quality_check_notes: null,
        quality_check_assigned_to: null,
        updated_at: now,
      })
      .eq("work_order_id", workOrderId);
    if (woError) throw woError;
  }

  await createAdminFlag({
    workOrderId,
    reason: "quality",
    note: `QC failed: ${trimmed}`,
  });

  await addTimelineEvent(supabase, {
    work_order_id: workOrderId,
    user_id: user.user_id,
    event_type: TimelineEventType.QUALITY_CHECK_COMPLETED,
    entity_type: "work_order",
    entity_id: workOrderId,
    description: `Peer QC failed: ${trimmed}`,
    new_value: { failed: true, reason: trimmed },
  });

  await addAuditLog(supabase, {
    actor_user_id: user.user_id,
    location_id: workOrder.location_id,
    action: "peer_qc_failed",
    entity_type: "work_order",
    entity_id: workOrderId,
    description: `Peer QC failed on ${workOrder.work_order_number}`,
    new_value: { reason: trimmed },
  });

  await recalculateWorkOrderStatus(supabase, workOrderId, user.user_id);
}
