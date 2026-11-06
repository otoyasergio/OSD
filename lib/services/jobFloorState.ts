import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/database/supabase-server";
import { createAdminClient } from "@/lib/database/supabase-admin";
import { addAuditLog } from "@/lib/audit/addAuditLog";
import type { FloorParkReason } from "@/lib/database/types";
import { readWorkflowV2Flags, v2WritesEnabled } from "@/lib/config/features";
import {
  isUndefinedColumnError,
  isUndefinedTableError,
  OPTIONAL_COLUMNS,
  getOptionalColumnSupport,
  setOptionalColumnSupport,
} from "@/lib/database/schemaCompat";
import { toRpcErrorCode } from "@/lib/services/errors";
import { pauseJobTime, switchJobTime } from "@/lib/services/jobTimeClock";
import { updateJobStatus } from "@/lib/services/jobs";
import { addTechnicianNote } from "@/lib/services/notes";
import { parkNoteForReason } from "@/lib/status/workDocumentation";
import { waitOwnerForParkReason } from "@/lib/technician/pitBoard";
import { assertCanStartJob, syncFloorQueue } from "@/lib/services/floorQueueSync";

const FLOOR_COLUMNS =
  "job_id, status, assigned_technician_id, floor_acknowledged_at, floor_acknowledged_by, floor_parked_at, floor_park_reason, floor_wait_owner, work_order_id";

export type JobFloorRow = {
  job_id: string;
  status: string;
  assigned_technician_id: string | null;
  floor_acknowledged_at: string | null;
  floor_acknowledged_by: string | null;
  floor_parked_at: string | null;
  floor_park_reason: FloorParkReason | null;
  floor_wait_owner: "front_desk" | "technician" | null;
  work_order_id: string;
};

async function loadJob(jobId: string): Promise<JobFloorRow> {
  const supabase = await createClient();
  const support = getOptionalColumnSupport(OPTIONAL_COLUMNS.jobFloorParkAck);
  const select =
    support === false
      ? "job_id, status, assigned_technician_id, work_order_id"
      : FLOOR_COLUMNS;

  const { data, error } = await supabase
    .from("job")
    .select(select)
    .eq("job_id", jobId)
    .single();

  if (error) {
    if (support !== false && isUndefinedColumnError(error, "floor_acknowledged")) {
      setOptionalColumnSupport(OPTIONAL_COLUMNS.jobFloorParkAck, false);
      return loadJob(jobId);
    }
    throw error;
  }

  if (support !== false) {
    setOptionalColumnSupport(OPTIONAL_COLUMNS.jobFloorParkAck, true);
  }

  const row = data as unknown as Partial<JobFloorRow> & {
    job_id: string;
    status: string;
    assigned_technician_id: string | null;
    work_order_id: string;
  };

  return {
    job_id: row.job_id,
    status: row.status,
    assigned_technician_id: row.assigned_technician_id,
    floor_acknowledged_at: row.floor_acknowledged_at ?? null,
    floor_acknowledged_by: row.floor_acknowledged_by ?? null,
    floor_parked_at: row.floor_parked_at ?? null,
    floor_park_reason: (row.floor_park_reason as FloorParkReason | null) ?? null,
    floor_wait_owner: row.floor_wait_owner ?? null,
    work_order_id: row.work_order_id,
  };
}

function assertAssignedToMe(job: JobFloorRow, userId: string) {
  if (job.assigned_technician_id !== userId) {
    throw new Error("FORBIDDEN");
  }
}

/**
 * Deterministic idempotency key for a floor intent so client double-taps and
 * duplicate submissions replay in the V2 commands instead of re-running.
 * Same intent + job + actor within one time bucket → same key.
 */
export function floorIdempotencyKey(
  intent: "pull" | "park" | "complete" | "clear",
  jobId: string,
  actorUserId: string,
  options: { extra?: string; bucketMs?: number; nowMs?: number } = {}
): string {
  const bucketMs = options.bucketMs ?? (intent === "pull" ? 15_000 : 60_000);
  const nowMs = options.nowMs ?? Date.now();
  const bucket = Math.floor(nowMs / Math.max(1, bucketMs));
  const parts = [intent, jobId, actorUserId];
  if (options.extra) parts.push(options.extra);
  parts.push(String(bucket));
  return parts.join(":");
}

/**
 * Invoke a V2 floor command as the service role, translating
 * RAISE EXCEPTION codes into the same Error codes legacy paths throw.
 */
async function callFloorCommand(
  fn: string,
  args: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc(fn, args);
  if (error) throw new Error(toRpcErrorCode(error));
  return (data ?? {}) as Record<string, unknown>;
}

export async function acknowledgeDocketJob(jobId: string): Promise<JobFloorRow> {
  const user = await requireUser();
  const job = await loadJob(jobId);
  assertAssignedToMe(job, user.user_id);

  if (job.floor_acknowledged_at) return job;

  if (getOptionalColumnSupport(OPTIONAL_COLUMNS.jobFloorParkAck) === false) {
    return job;
  }

  const supabase = await createClient();
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("job")
    .update({
      floor_acknowledged_at: now,
      floor_acknowledged_by: user.user_id,
      updated_at: now,
    })
    .eq("job_id", jobId)
    .select(FLOOR_COLUMNS)
    .single();

  if (error) {
    if (isUndefinedColumnError(error, "floor_acknowledged")) {
      setOptionalColumnSupport(OPTIONAL_COLUMNS.jobFloorParkAck, false);
      return job;
    }
    throw error;
  }

  await addAuditLog(supabase, {
    actor_user_id: user.user_id,
    location_id: user.active_location_id,
    action: "job_floor_acknowledge",
    entity_type: "job",
    entity_id: jobId,
    description: `${user.first_name} ${user.last_name} acknowledged docket job`,
  });

  return data as JobFloorRow;
}

async function recordFloorLine(jobId: string, note: string): Promise<void> {
  const job = await loadJob(jobId);
  await addTechnicianNote(job.work_order_id, {
    note,
    note_type: "general",
    job_id: jobId,
  });
}

const TECH_PARK_REASONS = new Set<FloorParkReason>([
  "parts",
  "approval",
  "tool",
  "other",
]);

function parkBlockerOwner(
  reason: FloorParkReason
): "technician" | "front_desk" | "parts" {
  if (reason === "parts") return "parts";
  if (reason === "approval") return "front_desk";
  if (reason === "tool") return "technician";
  return waitOwnerForParkReason(reason) === "technician" ? "technician" : "front_desk";
}

export async function parkJob(
  jobId: string,
  reason: FloorParkReason,
  note?: string | null
): Promise<JobFloorRow> {
  if (!TECH_PARK_REASONS.has(reason)) {
    throw new Error("PARK_REASON_NOT_ALLOWED");
  }
  const user = await requireUser();
  const line = parkNoteForReason(reason, note);
  const blockerOwner = parkBlockerOwner(reason);

  // V2: one transaction stops the timer, parks the job, and records the
  // blocker + domain event — no partial states on retry.
  if (v2WritesEnabled(readWorkflowV2Flags())) {
    const result = await callFloorCommand("workflow_v2_park_job", {
      p_job_id: jobId,
      p_actor_user_id: user.user_id,
      p_reason: reason,
      p_owner: blockerOwner,
      p_note: line,
      p_idempotency_key: floorIdempotencyKey("park", jobId, user.user_id, {
        extra: `${reason}:${line}`,
      }),
    });
    if (result.replayed !== true) {
      await recordFloorLine(jobId, line);
    }
    return loadJob(jobId);
  }

  const job = await loadJob(jobId);
  assertAssignedToMe(job, user.user_id);

  if (job.status !== "in_progress") {
    throw new Error("JOB_NOT_ON_BENCH");
  }

  try {
    await pauseJobTime();
  } catch (error) {
    if (!(error instanceof Error) || error.message !== "JOB_TIME_NOT_OPEN") {
      throw error;
    }
  }

  if (getOptionalColumnSupport(OPTIONAL_COLUMNS.jobFloorParkAck) === false) {
    return job;
  }

  const supabase = await createClient();
  const now = new Date().toISOString();
  const waitOwner = blockerOwner === "technician" ? "technician" : "front_desk";
  const { data, error } = await supabase
    .from("job")
    .update({
      status: reason === "parts" ? "waiting_for_parts" : "ready_to_start",
      floor_parked_at: now,
      floor_park_reason: reason,
      floor_wait_owner: waitOwner,
      updated_at: now,
    })
    .eq("job_id", jobId)
    .select(FLOOR_COLUMNS)
    .single();

  if (error) {
    if (isUndefinedColumnError(error, "floor_park")) {
      setOptionalColumnSupport(OPTIONAL_COLUMNS.jobFloorParkAck, false);
      return job;
    }
    throw error;
  }

  await addAuditLog(supabase, {
    actor_user_id: user.user_id,
    location_id: user.active_location_id,
    action: "job_floor_park",
    entity_type: "job",
    entity_id: jobId,
    description: `${user.first_name} ${user.last_name} parked job (${reason}): ${line}`,
    new_value: { reason, wait_owner: waitOwner, note: line },
  });

  await recordFloorLine(jobId, line);
  await openParkBlocker(jobId, user.user_id, reason, blockerOwner);

  return data as JobFloorRow;
}

async function clearParkFields(jobId: string): Promise<void> {
  if (getOptionalColumnSupport(OPTIONAL_COLUMNS.jobFloorParkAck) === false) {
    return;
  }
  const supabase = await createClient();
  const { error } = await supabase
    .from("job")
    .update({
      floor_parked_at: null,
      floor_park_reason: null,
      floor_wait_owner: null,
      updated_at: new Date().toISOString(),
    })
    .eq("job_id", jobId);

  if (error && isUndefinedColumnError(error, "floor_park")) {
    setOptionalColumnSupport(OPTIONAL_COLUMNS.jobFloorParkAck, false);
  } else if (error) {
    throw error;
  }
}

async function openParkBlocker(
  jobId: string,
  userId: string,
  reason: FloorParkReason,
  owner: string
): Promise<void> {
  try {
    const admin = createAdminClient();
    const { error } = await admin.from("job_blocker").insert({
      job_id: jobId,
      kind: reason,
      owner,
      opened_by_user_id: userId,
    });
    if (error && error.code !== "23505" && !isUndefinedTableError(error)) {
      throw error;
    }
  } catch (error) {
    if (error instanceof Error && error.message === "PARTS_CANADA_SYNC_MISCONFIGURED") {
      return;
    }
    throw error;
  }
}

async function closeToolBlocker(jobId: string, userId: string): Promise<void> {
  try {
    const admin = createAdminClient();
    const { error } = await admin
      .from("job_blocker")
      .update({
        cleared_at: new Date().toISOString(),
        cleared_by_user_id: userId,
      })
      .eq("job_id", jobId)
      .eq("kind", "tool")
      .is("cleared_at", null);
    if (error && !isUndefinedTableError(error)) throw error;
  } catch (error) {
    if (error instanceof Error && error.message === "PARTS_CANADA_SYNC_MISCONFIGURED") {
      return;
    }
    throw error;
  }
}

/** Same-bike services share one clock. Demote the sibling before the new start. */
/** Starting a different bike parks whatever clock is already running. */
async function parkOtherOpenClocks(userId: string, exceptJobId: string): Promise<void> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("job_time_entry")
    .select("job_id")
    .eq("user_id", userId)
    .is("ended_at", null)
    .neq("job_id", exceptJobId);
  if (error) {
    if (isUndefinedTableError(error, "job_time_entry")) return;
    throw error;
  }
  const ids = ((data ?? []) as Array<{ job_id: string }>)
    .map((row) => row.job_id)
    .filter((id) => id !== exceptJobId);
  if (ids.length === 0) return;

  const now = new Date().toISOString();
  const { error: endError } = await supabase
    .from("job_time_entry")
    .update({ ended_at: now })
    .eq("user_id", userId)
    .is("ended_at", null)
    .neq("job_id", exceptJobId);
  if (endError) throw endError;

  const { error: parkError } = await supabase
    .from("job")
    .update({
      status: "ready_to_start",
      floor_parked_at: now,
      floor_park_reason: "swapped",
      floor_wait_owner: "technician",
      updated_at: now,
    })
    .in("job_id", ids);
  if (parkError && !isUndefinedColumnError(parkError, "floor_park")) throw parkError;
}

async function releaseSameBikeClock(
  workOrderId: string,
  exceptJobId: string,
  userId: string
): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("job")
    .update({
      status: "ready_to_start",
      updated_at: new Date().toISOString(),
    })
    .eq("work_order_id", workOrderId)
    .eq("assigned_technician_id", userId)
    .eq("status", "in_progress")
    .neq("job_id", exceptJobId);
  if (error) throw error;
}

export async function pullOntoBench(jobId: string): Promise<{
  job: JobFloorRow;
  parked_job_id: string | null;
}> {
  const user = await requireUser();
  await assertCanStartJob(user.user_id, jobId);

  if (v2WritesEnabled(readWorkflowV2Flags())) {
    await callFloorCommand("workflow_v2_pull_job_onto_bench", {
      p_job_id: jobId,
      p_actor_user_id: user.user_id,
      p_idempotency_key: floorIdempotencyKey("pull", jobId, user.user_id),
    });
    let job = await loadJob(jobId);
    if (!job.floor_acknowledged_at) {
      job = await acknowledgeDocketJob(jobId);
    }
    return { job, parked_job_id: null };
  }

  const job = await loadJob(jobId);
  assertAssignedToMe(job, user.user_id);

  if (job.status === "waiting_for_approval") {
    throw new Error("JOB_AWAITING_CUSTOMER_APPROVAL");
  }

  if (
    !job.floor_acknowledged_at &&
    getOptionalColumnSupport(OPTIONAL_COLUMNS.jobFloorParkAck) !== false
  ) {
    await acknowledgeDocketJob(jobId);
  }

  await releaseSameBikeClock(job.work_order_id, jobId, user.user_id);
  await parkOtherOpenClocks(user.user_id, jobId);

  if (job.status !== "in_progress") {
    await updateJobStatus(jobId, "in_progress");
  } else {
    await switchJobTime(jobId);
  }

  await clearParkFields(jobId);
  await syncFloorQueue(await createClient(), job.work_order_id, user.user_id);

  const refreshed = await loadJob(jobId);
  return { job: refreshed, parked_job_id: null };
}

export async function resumeParkedJob(jobId: string): Promise<JobFloorRow> {
  const result = await pullOntoBench(jobId);
  return result.job;
}

/** Starting the other bike parks the one on the bench. */
export async function swapBenchJob(
  fromJobId: string,
  toJobId: string
): Promise<{
  from: JobFloorRow;
  to: JobFloorRow;
}> {
  const result = await pullOntoBench(toJobId);
  const from = await loadJob(fromJobId);
  return { from, to: result.job };
}

/**
 * The technician who owns a tool wait marks it clear.
 * The bike returns to its place in line. The clock stays stopped.
 */
export async function clearToolWait(jobId: string): Promise<JobFloorRow> {
  const user = await requireUser();
  const job = await loadJob(jobId);
  assertAssignedToMe(job, user.user_id);

  if (v2WritesEnabled(readWorkflowV2Flags())) {
    await callFloorCommand("workflow_v2_clear_tool_wait", {
      p_job_id: jobId,
      p_actor_user_id: user.user_id,
      p_idempotency_key: floorIdempotencyKey("clear", jobId, user.user_id),
    });
    return loadJob(jobId);
  }

  if (job.floor_park_reason !== "tool") {
    throw new Error("TOOL_WAIT_NOT_OPEN");
  }

  await clearParkFields(jobId);
  if (job.status === "in_progress") {
    const supabase = await createClient();
    const { error } = await supabase
      .from("job")
      .update({
        status: "ready_to_start",
        updated_at: new Date().toISOString(),
      })
      .eq("job_id", jobId);
    if (error) throw error;
  }
  await closeToolBlocker(jobId, user.user_id);
  await syncFloorQueue(await createClient(), job.work_order_id, user.user_id);
  return loadJob(jobId);
}

export async function clearParkOnComplete(jobId: string): Promise<void> {
  await clearParkFields(jobId);
}
