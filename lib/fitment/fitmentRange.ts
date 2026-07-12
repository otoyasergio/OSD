export function normalizeYmmKey(v: string): string {
  return v.trim().toUpperCase();
}

export function rowCoversYear(
  yearStart: number,
  yearEnd: number,
  year: number
): boolean {
  return year >= yearStart && year <= yearEnd;
}

export function distinctYearsFromRanges(
  rows: { year_start: number; year_end: number }[],
  currentYear = new Date().getFullYear()
): number[] {
  const years = new Set<number>();
  for (const row of rows) {
    const end = Math.min(row.year_end, currentYear + 1);
    for (let y = row.year_start; y <= end; y++) years.add(y);
  }
  return [...years].sort((a, b) => b - a);
}

export function makesForYear(
  rows: { make: string; year_start: number; year_end: number }[],
  year: number
): string[] {
  const makes = new Set<string>();
  for (const row of rows) {
    if (rowCoversYear(row.year_start, row.year_end, year)) {
      makes.add(row.make);
    }
  }
  return [...makes].sort((a, b) => a.localeCompare(b));
}

export function modelsForYearMake(
  rows: { make: string; model: string; year_start: number; year_end: number }[],
  year: number,
  make: string
): string[] {
  const target = normalizeYmmKey(make);
  const models = new Set<string>();
  for (const row of rows) {
    if (
      normalizeYmmKey(row.make) === target &&
      rowCoversYear(row.year_start, row.year_end, year)
    ) {
      models.add(row.model);
    }
  }
  return [...models].sort((a, b) => a.localeCompare(b));
}
