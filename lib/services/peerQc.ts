import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/database/supabase-server";
import type { DbClient } from "@/lib/database/types";
import { addAuditLog } from "@/lib/audit/addAuditLog";
import { addTimelineEvent } from "@/lib/timeline/addTimelineEvent";
import { TimelineEventType } from "@/lib/timeline/events";
import { canPerformPeerQualityCheck, canRunQualityCheck } from "@/lib/permissions";
import { pickPeerQcAssignee } from "@/lib/status/peerQcAssigner";
import { recalculateWorkOrderStatus } from "@/lib/status/recalculateWorkOrderStatus";
import { createAdminFlag } from "@/lib/services/adminFlags";
import { completeQualityCheck } from "@/lib/services/quality";

async function listClockedInTechnicianIds(
  supabase: DbClient,
  locationId: string
): Promise<string[]> {
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
    .select("user_id")
    .in("user_id", userIds)
    .eq("role", "technician")
    .eq("status", "active");
  if (techError) throw techError;
  return (techs ?? []).map((row: { user_id: string }) => row.user_id);
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
  if (clockedIn.length === 0) return null;

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

  if (!assignee) return null;

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

  if (canRunQualityCheck(user.role)) {
    await completeQualityCheck(workOrderId, notes);
    return;
  }

  if (workOrder.quality_check_assigned_to !== user.user_id) {
    throw new Error("QC_NOT_ASSIGNED_TO_YOU");
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

  for (const job of completedJobs) {
    const { error: jobError } = await supabase
      .from("job")
      .update({
        status: "ready_to_start",
        completed_at: null,
        updated_at: now,
      })
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
