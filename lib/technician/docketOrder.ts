export type DocketOrderable = {
  job_id: string;
  docket_position: number | null;
};

export type DocketMoveDirection = "up" | "down" | "top";

/**
 * Stable docket order: explicit positions ascending, unpositioned jobs last
 * in their incoming (created_at) order.
 */
export function sortByDocketPosition<T extends DocketOrderable>(jobs: T[]): T[] {
  return [...jobs].sort((a, b) => {
    if (a.docket_position != null && b.docket_position != null) {
      return a.docket_position - b.docket_position;
    }
    if (a.docket_position != null) return -1;
    if (b.docket_position != null) return 1;
    return 0;
  });
}

/** Append slot at the end of a tech's open docket (max position + 1). */
export function nextDocketPosition(positions: Array<number | null>): number {
  let max = 0;
  for (const position of positions) {
    if (position != null && position > max) max = position;
  }
  return max + 1;
}

/**
 * Move one job within a tech's docket and renumber the whole docket 1..n.
 * Returns only the rows whose stored position changes (also settles gaps
 * and unpositioned jobs, so an edge move still normalizes).
 */
export function moveDocketJob<T extends DocketOrderable>(
  jobs: T[],
  jobId: string,
  direction: DocketMoveDirection
): Array<{ job_id: string; docket_position: number }> {
  const ordered = sortByDocketPosition(jobs);
  const index = ordered.findIndex((job) => job.job_id === jobId);
  if (index === -1) return [];

  const target = direction === "top" ? 0 : direction === "up" ? index - 1 : index + 1;
  const clamped = Math.max(0, Math.min(target, ordered.length - 1));

  const next = [...ordered];
  const [moved] = next.splice(index, 1);
  next.splice(clamped, 0, moved);

  const updates: Array<{ job_id: string; docket_position: number }> = [];
  next.forEach((job, i) => {
    const position = i + 1;
    if (job.docket_position !== position) {
      updates.push({ job_id: job.job_id, docket_position: position });
    }
  });
  return updates;
}
