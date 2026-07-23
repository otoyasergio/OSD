import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/database/supabase-server";
import { addAuditLog } from "@/lib/audit/addAuditLog";
import { getOpenTimeClockEntry } from "@/lib/services/timeClock";

export type JobTimeEntry = {
  job_time_entry_id: string;
  job_id: string;
  user_id: string;
  location_id: string;
  started_at: string;
  ended_at: string | null;
  notes: string | null;
};

const COLUMNS =
  "job_time_entry_id, job_id, user_id, location_id, started_at, ended_at, notes";

export async function getOpenJobTimeEntry(userId?: string): Promise<JobTimeEntry | null> {
  const user = await requireUser();
  const supabase = await createClient();
  const target = userId ?? user.user_id;
  const { data, error } = await supabase
    .from("job_time_entry")
    .select(COLUMNS)
    .eq("user_id", target)
    .is("ended_at", null)
    .maybeSingle();
  if (error) throw error;
  return (data as JobTimeEntry) ?? null;
}

export async function listJobTimeEntriesForJob(jobId: string): Promise<JobTimeEntry[]> {
  await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("job_time_entry")
    .select(COLUMNS)
    .eq("job_id", jobId)
    .order("started_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as JobTimeEntry[];
}

/** Sum of segment durations in ms (open segments use nowMs). */
export function sumJobTimeMs(
  entries: Array<{ started_at: string; ended_at: string | null }>,
  nowMs = Date.now()
): number {
  let total = 0;
  for (const e of entries) {
    const start = new Date(e.started_at).getTime();
    if (Number.isNaN(start)) continue;
    const end = e.ended_at ? new Date(e.ended_at).getTime() : nowMs;
    if (Number.isNaN(end) || end < start) continue;
    total += end - start;
  }
  return total;
}

export async function startJobTime(jobId: string): Promise<JobTimeEntry> {
  const user = await requireUser();
  if (!user.active_location_id) throw new Error("NO_LOCATION");

  const attendance = await getOpenTimeClockEntry(user.user_id);
  if (!attendance) throw new Error("NOT_CLOCKED_IN_FOR_JOB");

  const open = await getOpenJobTimeEntry(user.user_id);
  if (open) {
    if (open.job_id === jobId) return open;
    throw new Error("JOB_TIME_ALREADY_OPEN");
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("job_time_entry")
    .insert({
      job_id: jobId,
      user_id: user.user_id,
      location_id: user.active_location_id,
    })
    .select(COLUMNS)
    .single();
  if (error) throw error;
  const entry = data as JobTimeEntry;

  await addAuditLog(supabase, {
    actor_user_id: user.user_id,
    location_id: user.active_location_id,
    action: "job_time_start",
    entity_type: "job_time_entry",
    entity_id: entry.job_time_entry_id,
    description: `${user.first_name} ${user.last_name} started job timer`,
    new_value: entry,
  });

  return entry;
}

export async function endOpenJobTime(
  options: { jobId?: string; notes?: string | null } = {}
): Promise<JobTimeEntry | null> {
  const user = await requireUser();
  const open = await getOpenJobTimeEntry(user.user_id);
  if (!open) return null;
  if (options.jobId && open.job_id !== options.jobId) {
    throw new Error("JOB_TIME_WRONG_JOB");
  }

  const supabase = await createClient();
  const endedAt = new Date().toISOString();
  const { data, error } = await supabase
    .from("job_time_entry")
    .update({
      ended_at: endedAt,
      notes: options.notes?.trim() || open.notes,
    })
    .eq("job_time_entry_id", open.job_time_entry_id)
    .select(COLUMNS)
    .single();
  if (error) throw error;
  const entry = data as JobTimeEntry;

  await addAuditLog(supabase, {
    actor_user_id: user.user_id,
    location_id: user.active_location_id,
    action: "job_time_end",
    entity_type: "job_time_entry",
    entity_id: entry.job_time_entry_id,
    description: `${user.first_name} ${user.last_name} paused/ended job timer`,
    old_value: open,
    new_value: entry,
  });

  return entry;
}

export async function pauseJobTime(): Promise<JobTimeEntry> {
  const ended = await endOpenJobTime();
  if (!ended) throw new Error("JOB_TIME_NOT_OPEN");
  return ended;
}

/** End current open job timer (if any) and start a timer on the target job. */
export async function switchJobTime(toJobId: string): Promise<JobTimeEntry> {
  const open = await getOpenJobTimeEntry();
  if (open) {
    if (open.job_id === toJobId) return open;
    await endOpenJobTime({ jobId: open.job_id });
  }
  return startJobTime(toJobId);
}

export async function sumJobTimeMsForJob(
  jobId: string,
  nowMs = Date.now()
): Promise<number> {
  const entries = await listJobTimeEntriesForJob(jobId);
  return sumJobTimeMs(entries, nowMs);
}
