/**
 * Active shop for the session. Membership order matters: a missing cookie
 * must not land a new technician on whichever UUID sorts first (Ottawa
 * currently wins that race, which hides Toronto jobs on the floor).
 */

function createdAtMs(value: string | null): number {
  if (!value) return Number.POSITIVE_INFINITY;
  const normalized = value
    .trim()
    .replace(" ", "T")
    .replace(/([+-]\d{2})$/, "$1:00");
  const ms = Date.parse(normalized);
  return Number.isFinite(ms) ? ms : Number.POSITIVE_INFINITY;
}

export function sortMembershipLocationIds(
  rows: ReadonlyArray<{ location_id: string; created_at: string | null }>
): string[] {
  return [...rows]
    .sort((a, b) => {
      const delta = createdAtMs(a.created_at) - createdAtMs(b.created_at);
      if (delta !== 0) return delta;
      return a.location_id.localeCompare(b.location_id);
    })
    .map((row) => row.location_id);
}

export function resolveActiveLocationId(
  locationIds: readonly string[],
  cookieLocationId: string | null
): string | null {
  if (cookieLocationId && locationIds.includes(cookieLocationId)) {
    return cookieLocationId;
  }
  return locationIds[0] ?? null;
}
