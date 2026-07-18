import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/database/supabase-server";
import { addAuditLog } from "@/lib/audit/addAuditLog";
import type { FloorParkReason } from "@/lib/database/types";
import {
  isUndefinedColumnError,
  OPTIONAL_COLUMNS,
  getOptionalColumnSupport,
  setOptionalColumnSupport,
} from "@/lib/database/schemaCompat";
import { waitOwnerForParkReason } from "@/lib/technician/pitBoard";
import { pauseJobTime, switchJobTime } from "@/lib/services/jobTimeClock";
import { updateJobStatus } from "@/lib/services/jobs";

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

export async function parkJob(
  jobId: string,
  reason: FloorParkReason
): Promise<JobFloorRow> {
  const user = await requireUser();
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
  const waitOwner = waitOwnerForParkReason(reason);
  const { data, error } = await supabase
    .from("job")
    .update({
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
    description: `${user.first_name} ${user.last_name} parked job (${reason})`,
    new_value: { reason, wait_owner: waitOwner },
  });

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

/** Find this tech's other in-progress job (if any) and park it as swapped. */
async function autoParkBenchSibling(exceptJobId: string): Promise<string | null> {
  const user = await requireUser();
  const supabase = await createClient();
  const support = getOptionalColumnSupport(OPTIONAL_COLUMNS.jobFloorParkAck);

  const query = supabase
    .from("job")
    .select(support === false ? "job_id, status" : "job_id, status, floor_parked_at")
    .eq("assigned_technician_id", user.user_id)
    .eq("status", "in_progress")
    .neq("job_id", exceptJobId);

  const { data, error } = await query;
  if (error) {
    if (support !== false && isUndefinedColumnError(error, "floor_parked")) {
      setOptionalColumnSupport(OPTIONAL_COLUMNS.jobFloorParkAck, false);
      return autoParkBenchSibling(exceptJobId);
    }
    throw error;
  }

  const siblings = (data ?? []) as unknown as Array<{
    job_id: string;
    status: string;
    floor_parked_at?: string | null;
  }>;

  const active = siblings.find((j) => !j.floor_parked_at);
  if (!active) return null;

  await parkJob(active.job_id, "swapped");
  return active.job_id;
}

export async function pullOntoBench(jobId: string): Promise<{
  job: JobFloorRow;
  parked_job_id: string | null;
}> {
  const user = await requireUser();
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

  const parkedJobId = await autoParkBenchSibling(jobId);

  if (job.status !== "in_progress") {
    await updateJobStatus(jobId, "in_progress");
  } else {
    await switchJobTime(jobId);
  }

  await clearParkFields(jobId);

  const refreshed = await loadJob(jobId);
  return { job: refreshed, parked_job_id: parkedJobId };
}

export async function resumeParkedJob(jobId: string): Promise<JobFloorRow> {
  const result = await pullOntoBench(jobId);
  return result.job;
}

export async function swapBenchJob(
  fromJobId: string,
  toJobId: string
): Promise<{
  from: JobFloorRow;
  to: JobFloorRow;
}> {
  const user = await requireUser();
  const from = await loadJob(fromJobId);
  const to = await loadJob(toJobId);
  assertAssignedToMe(from, user.user_id);
  assertAssignedToMe(to, user.user_id);

  if (from.job_id === to.job_id) {
    throw new Error("SWAP_SAME_JOB");
  }

  if (from.status === "in_progress" && !from.floor_parked_at) {
    await parkJob(fromJobId, "swapped");
  }

  const pulled = await pullOntoBench(toJobId);
  return { from: await loadJob(fromJobId), to: pulled.job };
}

export async function clearParkOnComplete(jobId: string): Promise<void> {
  await clearParkFields(jobId);
}
