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
