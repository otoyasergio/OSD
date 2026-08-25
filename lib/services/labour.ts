/**
 * Format estimated vs actual labour for display on jobs.
 * Prefer summed job_time_entry segments when provided; otherwise fall back to
 * wall-clock (completedAt ?? now) - startedAt.
 */
export function formatLabourComparison(
  estimatedHours: number | null,
  startedAt: string | null,
  completedAt: string | null,
  options?: { actualMsFromSegments?: number | null }
): { label: string; overEstimate: boolean } | null {
  let actualHours: number | null = null;

  if (options?.actualMsFromSegments != null && options.actualMsFromSegments >= 0) {
    actualHours = options.actualMsFromSegments / (1000 * 60 * 60);
  } else if (startedAt) {
    const startMs = new Date(startedAt).getTime();
    const endMs = completedAt ? new Date(completedAt).getTime() : Date.now();
    actualHours = (endMs - startMs) / (1000 * 60 * 60);
  }

  if (actualHours == null) return null;

  const actualLabel = formatHours(actualHours);

  const parts: string[] = [];
  if (estimatedHours != null) {
    parts.push(`Est ${formatHours(estimatedHours)}h`);
  }
  parts.push(`Actual ${actualLabel}h`);

  const overEstimate = estimatedHours != null && actualHours > estimatedHours * 1.1;

  return {
    label: parts.join(" · "),
    overEstimate,
  };
}

function formatHours(hours: number): string {
  const rounded = Math.round(hours * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}
