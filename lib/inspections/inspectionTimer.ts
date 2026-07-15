export const INSPECTION_TARGET_MS = 20 * 60 * 1000;

export type InspectionTimerState = {
  mode: "countdown" | "overtime";
  display: string;
  totalElapsedMs: number;
  remainingMs: number;
  overtimeMs: number;
};

function formatMmSs(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

/**
 * Pure timer state from wall-clock started_at.
 * Countdown from 20 minutes, then overtime count-up.
 */
export function getInspectionTimerState(
  startedAt: string | Date,
  now: Date | number = Date.now()
): InspectionTimerState {
  const startMs =
    typeof startedAt === "string" ? Date.parse(startedAt) : startedAt.getTime();
  const nowMs = typeof now === "number" ? now : now.getTime();
  const totalElapsedMs = Math.max(0, nowMs - startMs);
  const remainingMs = INSPECTION_TARGET_MS - totalElapsedMs;

  if (remainingMs > 0) {
    return {
      mode: "countdown",
      display: formatMmSs(remainingMs),
      totalElapsedMs,
      remainingMs,
      overtimeMs: 0,
    };
  }

  const overtimeMs = totalElapsedMs - INSPECTION_TARGET_MS;
  return {
    mode: "overtime",
    display: `+${formatMmSs(overtimeMs)}`,
    totalElapsedMs,
    remainingMs: 0,
    overtimeMs,
  };
}
