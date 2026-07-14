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
