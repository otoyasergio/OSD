const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;

export type ControlCenterAtRiskInput = {
  overdue: boolean;
  safetyCritical: boolean;
  /** Latest job activity timestamp (started_at / updated_at / created_at). */
  lastJobActivityAt: string | null | undefined;
  now?: Date;
};

export function isJobIdleAtLeastThreeDays(
  lastJobActivityAt: string | null | undefined,
  now: Date = new Date()
): boolean {
  if (!lastJobActivityAt) return false;
  const at = new Date(lastJobActivityAt).getTime();
  if (Number.isNaN(at)) return false;
  return now.getTime() - at >= THREE_DAYS_MS;
}

export function isControlCenterAtRisk(input: ControlCenterAtRiskInput): boolean {
  const now = input.now ?? new Date();
  if (input.overdue) return true;
  if (input.safetyCritical) return true;
  return isJobIdleAtLeastThreeDays(input.lastJobActivityAt, now);
}

/** Max of candidate ISO timestamps; ignores null/invalid. */
export function latestJobActivityAt(
  timestamps: Array<string | null | undefined>
): string | null {
  let best: string | null = null;
  let bestMs = -Infinity;
  for (const value of timestamps) {
    if (!value) continue;
    const ms = new Date(value).getTime();
    if (Number.isNaN(ms)) continue;
    if (ms >= bestMs) {
      bestMs = ms;
      best = value;
    }
  }
  return best;
}
