/** Shop metric math shared by the Reports page and the weekly report email. */

export type PunchInput = {
  startedAt: string | null;
  endedAt: string | null;
};

export type PunchBounds = {
  /** Treated as the end of punches that are still open. */
  now: Date;
  /** Count only time after this instant. */
  from?: Date;
  /** Count only time up to this instant. */
  to?: Date;
};

/** Part statuses that still need shop attention before a job can finish. */
export const PARTS_WAITING_STATUSES = ["needed", "ordered", "in_stock"] as const;

export function roundTenth(value: number): number {
  return Math.round(value * 10) / 10;
}

function punchHours(punch: PunchInput, bounds: PunchBounds): number {
  if (!punch.startedAt) return 0;
  const start = new Date(punch.startedAt).getTime();
  if (Number.isNaN(start)) return 0;
  const rawEnd = punch.endedAt ? new Date(punch.endedAt).getTime() : NaN;
  const end = Number.isNaN(rawEnd) ? bounds.now.getTime() : rawEnd;
  const from = bounds.from ? Math.max(start, bounds.from.getTime()) : start;
  const to = bounds.to ? Math.min(end, bounds.to.getTime()) : end;
  if (to <= from) return 0;
  return (to - from) / (1000 * 60 * 60);
}

/** Total punch hours within `bounds`, rounded to a tenth of an hour. */
export function sumPunchHours(punches: PunchInput[], bounds: PunchBounds): number {
  return roundTenth(punches.reduce((sum, punch) => sum + punchHours(punch, bounds), 0));
}

/** Job hours as a percentage of staff hours, to one decimal; null with no staff hours. */
export function efficiencyPercent(jobHours: number, techHours: number): number | null {
  if (techHours <= 0) return null;
  return Math.round((jobHours / techHours) * 1000) / 10;
}
