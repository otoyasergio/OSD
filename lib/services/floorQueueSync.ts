import "server-only";

import { createAdminClient } from "@/lib/database/supabase-admin";
import type { DbClient } from "@/lib/database/types";
import { isUndefinedTableError } from "@/lib/database/schemaCompat";
import { recalculateWorkOrderStatus } from "@/lib/status/recalculateWorkOrderStatus";
import {
  decideFloorQueue,
  planFloorSync,
  startRefusal,
  type QueueBlocker,
  type QueueService,
} from "@/lib/technician/floorQueue";

type JobRow = {
  job_id: string;
  work_order_id: string;
  status: string;
  assigned_technician_id: string | null;
  docket_position: number | null;
  service_name_snapshot: string | null;
};

type BlockerRow = QueueBlocker & { job_blocker_id: string };

function isUniqueViolation(error: { code?: string } | null): boolean {
  return error?.code === "23505";
}

async function loadQueueSnapshot(workOrderId: string): Promise<{
  locationId: string;
  services: QueueService[];
  blockers: BlockerRow[];
} | null> {
  const admin = createAdminClient();
  const { data: workOrder, error: workOrderError } = await admin
    .from("work_order")
    .select("location_id")
    .eq("work_order_id", workOrderId)
    .maybeSingle();
  if (workOrderError) throw workOrderError;
  if (!workOrder) return null;

  const { data: jobs, error: jobsError } = await admin
    .from("job")
    .select(
      "job_id, work_order_id, status, assigned_technician_id, docket_position, service_name_snapshot"
    )
    .eq("work_order_id", workOrderId);
  if (jobsError) throw jobsError;
  const jobRows = (jobs ?? []) as JobRow[];
  const jobIds = jobRows.map((job) => job.job_id);
  if (jobIds.length === 0) {
    return { locationId: workOrder.location_id as string, services: [], blockers: [] };
  }

  const { data: parts, error: partsError } = await admin
    .from("part")
    .select("job_id, status")
    .in("job_id", jobIds);
  if (partsError) throw partsError;

  const { data: clocks, error: clockError } = await admin
    .from("job_time_entry")
    .select("job_id, user_id")
    .in("job_id", jobIds)
    .is("ended_at", null);
  if (clockError && !isUndefinedTableError(clockError, "job_time_entry"))
    throw clockError;

  const { data: blockerRows, error: blockerError } = await admin
    .from("job_blocker")
    .select("job_blocker_id, job_id, kind, opened_at")
    .in("job_id", jobIds)
    .is("cleared_at", null);
  if (blockerError && !isUndefinedTableError(blockerError, "job_blocker"))
    throw blockerError;

  const partRows = (parts ?? []) as Array<{ job_id: string; status: string }>;
  const clockRows = (clocks ?? []) as Array<{ job_id: string; user_id: string }>;
  const services: QueueService[] = jobRows.map((job) => ({
    job_id: job.job_id,
    work_order_id: job.work_order_id,
    assigned_technician_id: job.assigned_technician_id,
    status: job.status,
    docket_position: job.docket_position,
    service_name: job.service_name_snapshot,
    parts: partRows.filter((part) => part.job_id === job.job_id),
    timer_running: clockRows.some(
      (clock) =>
        clock.job_id === job.job_id && clock.user_id === job.assigned_technician_id
    ),
  }));

  return {
    locationId: workOrder.location_id as string,
    services,
    blockers: blockerError ? [] : ((blockerRows ?? []) as BlockerRow[]),
  };
}

async function appendQueueEvent(input: {
  jobId: string;
  workOrderId: string;
  eventType: string;
  actorUserId: string | null;
  kind: string;
  owner?: string | null;
}): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.rpc("workflow_v2_append_event", {
    p_aggregate_type: "job",
    p_aggregate_id: input.jobId,
    p_work_order_id: input.workOrderId,
    p_event_type: input.eventType,
    p_actor_type: input.actorUserId ? "staff" : "customer",
    p_actor_user_id: input.actorUserId,
    p_old_value: null,
    p_new_value: { kind: input.kind, owner: input.owner ?? null },
    p_idempotency_key: null,
    p_correlation_id: null,
    p_portal_token_id: null,
  });
  if (error && !isUndefinedTableError(error, "domain_event")) {
    // The event is the measure. A missing function on an old database
    // must not block the blocker write that already happened.
    if (!/workflow_v2_append_event/i.test(error.message ?? "")) throw error;
  }
}

/**
 * Open or close parts and approval blockers from the current record, and
 * move or stop the job clock. Tool waits are not touched. Does not start
 * a clock that is not already running.
 */
export async function syncFloorQueue(
  _supabase: DbClient,
  workOrderId: string,
  actorUserId: string | null
): Promise<void> {
  const snapshot = await loadQueueSnapshot(workOrderId);
  if (!snapshot) return;
  const admin = createAdminClient();
  const plan = planFloorSync({
    services: snapshot.services,
    blockers: snapshot.blockers,
  });
  const now = new Date().toISOString();

  for (const change of plan.open) {
    const service = snapshot.services.find((row) => row.job_id === change.job_id);
    const { error } = await admin.from("job_blocker").insert({
      job_id: change.job_id,
      location_id: snapshot.locationId,
      kind: change.kind,
      owner: change.owner,
      reason:
        change.kind === "approval" ? "Waiting for customer OK" : "Waiting for parts",
      opened_by_user_id: actorUserId,
    });
    if (error) {
      if (isUniqueViolation(error) || isUndefinedTableError(error, "job_blocker"))
        continue;
      throw error;
    }
    await appendQueueEvent({
      jobId: change.job_id,
      workOrderId: service?.work_order_id ?? workOrderId,
      eventType: "floor_wait_opened",
      actorUserId,
      kind: change.kind,
      owner: change.owner,
    });
  }

  for (const change of plan.close) {
    const { error } = await admin
      .from("job_blocker")
      .update({
        cleared_at: now,
        cleared_by_user_id: actorUserId,
      })
      .eq("job_id", change.job_id)
      .eq("kind", change.kind)
      .is("cleared_at", null);
    if (error) {
      if (isUndefinedTableError(error, "job_blocker")) continue;
      throw error;
    }
    const service = snapshot.services.find((row) => row.job_id === change.job_id);
    await appendQueueEvent({
      jobId: change.job_id,
      workOrderId: service?.work_order_id ?? workOrderId,
      eventType: "floor_wait_cleared",
      actorUserId,
      kind: change.kind,
    });
  }

  for (const clock of plan.clocks) {
    if (clock.action === "keep") continue;
    const { error: endError } = await admin
      .from("job_time_entry")
      .update({ ended_at: now })
      .eq("user_id", clock.technician_id)
      .is("ended_at", null);
    if (endError && !isUndefinedTableError(endError, "job_time_entry")) throw endError;
    if (clock.action === "switch" && clock.job_id) {
      const { error: startError } = await admin.from("job_time_entry").insert({
        job_id: clock.job_id,
        user_id: clock.technician_id,
        location_id: snapshot.locationId,
      });
      if (startError && !isUndefinedTableError(startError, "job_time_entry"))
        throw startError;
    }
  }

  await recalculateWorkOrderStatus(admin, workOrderId, actorUserId);
}

export type OpenServiceBlocker = {
  job_id: string;
  service_name: string;
  kind: "approval" | "parts";
  owner: string;
  opened_at: string;
};

export async function listOpenServiceBlockers(
  workOrderId: string
): Promise<OpenServiceBlocker[]> {
  let admin;
  try {
    admin = createAdminClient();
  } catch (error) {
    if (error instanceof Error && error.message === "PARTS_CANADA_SYNC_MISCONFIGURED") {
      return [];
    }
    throw error;
  }
  const { data: jobs, error: jobsError } = await admin
    .from("job")
    .select("job_id, service_name_snapshot")
    .eq("work_order_id", workOrderId);
  if (jobsError) throw jobsError;
  const jobRows = (jobs ?? []) as Array<{
    job_id: string;
    service_name_snapshot: string | null;
  }>;
  if (jobRows.length === 0) return [];
  const names = new Map(
    jobRows.map((job) => [job.job_id, job.service_name_snapshot?.trim() || "Service"])
  );
  const { data, error } = await admin
    .from("job_blocker")
    .select("job_id, kind, owner, opened_at")
    .in(
      "job_id",
      jobRows.map((job) => job.job_id)
    )
    .is("cleared_at", null)
    .in("kind", ["approval", "parts"]);
  if (error) {
    if (isUndefinedTableError(error, "job_blocker")) return [];
    throw error;
  }
  return (
    (data ?? []) as Array<{
      job_id: string;
      kind: "approval" | "parts";
      owner: string;
      opened_at: string;
    }>
  ).map((row) => ({
    job_id: row.job_id,
    service_name: names.get(row.job_id) ?? "Service",
    kind: row.kind,
    owner: row.owner,
    opened_at: row.opened_at,
  }));
}

/** Loads one technician's open jobs and refuses an illegal start. */
export async function assertCanStartJob(
  technicianId: string,
  jobId: string
): Promise<void> {
  const admin = createAdminClient();
  const { data: target, error: targetError } = await admin
    .from("job")
    .select("job_id, work_order_id, assigned_technician_id")
    .eq("job_id", jobId)
    .maybeSingle();
  if (targetError) throw targetError;
  if (!target) throw new Error("JOB_NOT_FOUND");

  const assignee =
    (target.assigned_technician_id as string | null) &&
    target.assigned_technician_id !== technicianId
      ? (target.assigned_technician_id as string)
      : technicianId;

  const { data: jobs, error: jobsError } = await admin
    .from("job")
    .select("job_id, work_order_id, status, assigned_technician_id, docket_position")
    .eq("assigned_technician_id", assignee)
    .not("status", "in", '("completed","cancelled","declined")');
  if (jobsError) throw jobsError;
  const jobRows = (jobs ?? []) as Array<{
    job_id: string;
    work_order_id: string;
    status: string;
    assigned_technician_id: string | null;
    docket_position: number | null;
  }>;
  const jobIds = jobRows.map((job) => job.job_id);
  if (!jobIds.includes(jobId)) {
    jobIds.push(jobId);
  }

  const { data: parts, error: partsError } = await admin
    .from("part")
    .select("job_id, status")
    .in("job_id", jobIds.length > 0 ? jobIds : ["00000000-0000-0000-0000-000000000000"]);
  if (partsError) throw partsError;
  const { data: blockers, error: blockerError } = await admin
    .from("job_blocker")
    .select("job_id, kind, opened_at")
    .in("job_id", jobIds.length > 0 ? jobIds : ["00000000-0000-0000-0000-000000000000"])
    .is("cleared_at", null);
  if (blockerError && !isUndefinedTableError(blockerError, "job_blocker"))
    throw blockerError;
  const { data: clocks, error: clockError } = await admin
    .from("job_time_entry")
    .select("job_id, user_id")
    .eq("user_id", assignee)
    .is("ended_at", null);
  if (clockError && !isUndefinedTableError(clockError, "job_time_entry"))
    throw clockError;

  const partRows = (parts ?? []) as Array<{ job_id: string; status: string }>;
  const clockJobId = ((clocks ?? []) as Array<{ job_id: string }>)[0]?.job_id ?? null;
  const services: QueueService[] = jobRows.map((job) => ({
    job_id: job.job_id,
    work_order_id: job.work_order_id,
    assigned_technician_id: assignee,
    status: job.status,
    docket_position: job.docket_position,
    parts: partRows.filter((part) => part.job_id === job.job_id),
    timer_running: job.job_id === clockJobId,
  }));
  if (!services.some((service) => service.job_id === jobId)) {
    services.push({
      job_id: jobId,
      work_order_id: target.work_order_id as string,
      assigned_technician_id: assignee,
      status: "approved",
      docket_position: null,
      parts: partRows.filter((part) => part.job_id === jobId),
      timer_running: jobId === clockJobId,
    });
  }

  const decision = decideFloorQueue({
    technician_id: assignee,
    services,
    blockers: blockerError ? [] : ((blockers ?? []) as QueueBlocker[]),
  });
  const refusal = startRefusal(decision, target.work_order_id as string);
  if (refusal) throw new Error(refusal);
}
