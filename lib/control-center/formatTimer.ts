/** Format elapsed ms as H:MM:SS (unbounded hours) or M:SS under one hour. */
export function formatElapsedTimer(elapsedMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
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
