/**
 * Format estimated vs actual labour for display on jobs.
 * Actual hours = (completedAt ?? now) - startedAt in decimal hours.
 * overEstimate when actual > estimate × 1.1 (only when estimate is present).
 */
export function formatLabourComparison(
  estimatedHours: number | null,
  startedAt: string | null,
  completedAt: string | null
): { label: string; overEstimate: boolean } | null {
  if (!startedAt) return null;

  const startMs = new Date(startedAt).getTime();
  const endMs = completedAt
    ? new Date(completedAt).getTime()
    : Date.now();
  const actualHours = (endMs - startMs) / (1000 * 60 * 60);
  const actualLabel = formatHours(actualHours);

  const parts: string[] = [];
  if (estimatedHours != null) {
    parts.push(`Est ${formatHours(estimatedHours)}h`);
  }
  parts.push(`Actual ${actualLabel}h`);

  const overEstimate =
    estimatedHours != null && actualHours > estimatedHours * 1.1;

  return {
    label: parts.join(" · "),
    overEstimate,
  };
}

function formatHours(hours: number): string {
  const rounded = Math.round(hours * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}
