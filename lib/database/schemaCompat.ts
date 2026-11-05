/**
 * Postgres undefined_column — PostgREST surfaces this when a select/filter/update
 * references a column that has not been migrated onto the remote DB yet.
 */
export function isUndefinedColumnError(
  error: { code?: string; message?: string } | null | undefined,
  columnFragment?: string
): boolean {
  if (!error || error.code !== "42703") return false;
  if (!columnFragment) return true;
  return (error.message ?? "").toLowerCase().includes(columnFragment.toLowerCase());
}

/**
 * Missing relation. Postgres reports 42P01 once the query reaches the database.
 * PostgREST reports PGRST205 ("Could not find the table … in the schema cache")
 * when the table was never migrated, before any SQL runs. Callers use this so
 * an unapplied migration degrades to an empty result instead of a page error.
 */
export function isUndefinedTableError(
  error: { code?: string; message?: string } | null | undefined,
  tableFragment?: string
): boolean {
  if (!error || (error.code !== "42P01" && error.code !== "PGRST205")) return false;
  if (!tableFragment) return true;
  return (error.message ?? "").toLowerCase().includes(tableFragment.toLowerCase());
}

/**
 * Process-local cache for optional columns that may be missing before migrations
 * land. Avoids re-paying a failed PostgREST round-trip on every request.
 */
const optionalColumnSupported = new Map<string, boolean>();

export function getOptionalColumnSupport(key: string): boolean | null {
  return optionalColumnSupported.has(key) ? optionalColumnSupported.get(key)! : null;
}

export function setOptionalColumnSupport(key: string, supported: boolean): void {
  optionalColumnSupported.set(key, supported);
}

export const OPTIONAL_COLUMNS = {
  jobDocketPosition: "job.docket_position",
  workOrderOpenedAt: "work_order.opened_at",
  jobFloorParkAck: "job.floor_acknowledged_at",
} as const;
