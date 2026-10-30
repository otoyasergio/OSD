const DAY_MS = 24 * 60 * 60 * 1000;

/** Hours as H:MM:SS (or M:SS under one hour) until 24 hours, then whole days. */
export function formatElapsedTimer(elapsedMs: number): string {
  const safeMs = Math.max(0, elapsedMs);
  if (safeMs >= DAY_MS) {
    const days = Math.floor(safeMs / DAY_MS);
    return days === 1 ? "1 day" : `${days} days`;
  }

  const totalSeconds = Math.floor(safeMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const mm = String(minutes).padStart(2, "0");
  const ss = String(seconds).padStart(2, "0");
  if (hours > 0) return `${hours}:${mm}:${ss}`;
  return `${minutes}:${ss}`;
}

export function timeInShopTone(elapsedMs: number): "fresh" | "aging" | "stale" {
  const hours = elapsedMs / (1000 * 60 * 60);
  if (hours >= 48) return "stale";
  if (hours >= 24) return "aging";
  return "fresh";
}

/**
 * Average time in shop (in days, rounded to 1 decimal place) across active shop
 * bikes. Bikes in Complete (`completed`), Storage (`in_storage`), or Cancelled
 * (`cancelled`) do not count toward the average.
 */
export function calculateAverageDaysInShop(
  rows: ReadonlyArray<{
    status: string;
    date_created?: string | null;
    created_at?: string | null;
  }>,
  now: Date = new Date()
): number | null {
  const nowMs = now.getTime();
  const daysList: number[] = [];
  for (const row of rows) {
    if (
      row.status === "completed" ||
      row.status === "in_storage" ||
      row.status === "cancelled"
    ) {
      continue;
    }
    const stamp = row.date_created ?? row.created_at;
    if (!stamp) continue;
    const startMs = new Date(stamp).getTime();
    if (!Number.isFinite(startMs)) continue;
    const elapsedMs = Math.max(0, nowMs - startMs);
    daysList.push(elapsedMs / DAY_MS);
  }
  if (daysList.length === 0) return null;
  const mean = daysList.reduce((sum, d) => sum + d, 0) / daysList.length;
  return Math.round(mean * 10) / 10;
}
