import {
  isUndefinedColumnError,
  isUndefinedTableError,
} from "@/lib/database/schemaCompat";

/**
 * Floor columns added after the first job table. A shop that has not migrated
 * them yet can still leave the bench by updating status alone.
 */
const OPTIONAL_RELEASE_COLUMNS = [
  "work_state",
  "floor_parked_at",
  "floor_park_reason",
  "floor_wait_owner",
] as const;

type PostgrestError = { code?: string; message?: string } | null;

export type DispatchReleaseClient = {
  from(table: string): {
    select(columns: string): {
      eq(
        column: string,
        value: string
      ): PromiseLike<{
        data: Array<{ job_id: string }> | null;
        error: PostgrestError;
      }>;
    };
    update(values: Record<string, unknown>): {
      in(
        column: string,
        values: string[]
      ): {
        is(column: string, value: null): PromiseLike<{ error: PostgrestError }>;
      };
      eq(
        column: string,
        value: string
      ): {
        eq(column: string, value: string): PromiseLike<{ error: PostgrestError }>;
      };
    };
  };
};

function releaseUpdate(
  omitted: ReadonlySet<string>,
  now: string
): Record<string, unknown> {
  const update: Record<string, unknown> = {
    status: "ready_to_start",
    updated_at: now,
  };
  if (!omitted.has("work_state")) update.work_state = "ready";
  if (!omitted.has("floor_parked_at")) update.floor_parked_at = null;
  if (!omitted.has("floor_park_reason")) update.floor_park_reason = null;
  if (!omitted.has("floor_wait_owner")) update.floor_wait_owner = null;
  return update;
}

function missingReleaseColumn(
  error: PostgrestError,
  omitted: ReadonlySet<string>
): string | null {
  for (const column of OPTIONAL_RELEASE_COLUMNS) {
    if (omitted.has(column)) continue;
    if (isUndefinedColumnError(error, column)) return column;
  }
  return null;
}

/**
 * The front office is taking this visit off the technician who was wrenching it.
 * Ending the clock is not enough: a job left `in_progress` with no park time
 * still counts as the bench, so the next Start is refused and can stop the
 * clock on the bike that technician was already working.
 */
export async function releaseDispatchedBench(
  supabase: DispatchReleaseClient,
  workOrderId: string,
  now = new Date().toISOString()
): Promise<void> {
  const { data: jobs, error } = await supabase
    .from("job")
    .select("job_id")
    .eq("work_order_id", workOrderId);
  if (error) throw error;
  const jobIds = (jobs ?? []).map((row) => row.job_id).filter(Boolean);
  if (jobIds.length === 0) return;

  const { error: clockError } = await supabase
    .from("job_time_entry")
    .update({ ended_at: now })
    .in("job_id", jobIds)
    .is("ended_at", null);
  if (clockError && !isUndefinedTableError(clockError, "job_time_entry"))
    throw clockError;

  const omitted = new Set<string>();
  for (;;) {
    const { error: releaseError } = await supabase
      .from("job")
      .update(releaseUpdate(omitted, now))
      .eq("work_order_id", workOrderId)
      .eq("status", "in_progress");
    if (!releaseError) return;
    const missing = missingReleaseColumn(releaseError, omitted);
    if (!missing) throw releaseError;
    omitted.add(missing);
  }
}
