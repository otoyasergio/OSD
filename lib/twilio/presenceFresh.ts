export const PRESENCE_STALE_MS = 90_000;

export function isPresenceFresh(
  updatedAt: string | null | undefined,
  now: Date = new Date()
): boolean {
  if (!updatedAt) return false;
  const then = new Date(updatedAt).getTime();
  if (Number.isNaN(then)) return false;
  return now.getTime() - then <= PRESENCE_STALE_MS;
}
