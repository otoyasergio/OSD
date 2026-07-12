/**
 * Model year from VIS position 10 (ISO 3779 / 49 CFR 565).
 * Letters A–Y (no I/O/Q/U/Z) and digits 1–9 encode a 30-year cycle.
 * Returns candidate years in the modern cycle (prefer 2001+ when ambiguous).
 */

const YEAR_CODES =
  "ABCDEFGHJKLMNPRSTVWXY123456789" as const; // 30 codes; no I O Q U Z

/** Code → offset within the 30-year cycle starting at year `cycleStart`. */
function yearForCode(code: string, cycleStart: number): number | null {
  const index = YEAR_CODES.indexOf(code);
  if (index < 0) return null;
  return cycleStart + index;
}

/**
 * Decode model year candidates from position 10.
 * Prefers the most recent plausible year ≤ currentYear + 1.
 */
export function decodeModelYearCode(
  yearCode: string,
  currentYear = new Date().getFullYear()
): number | null {
  if (!yearCode || yearCode.length !== 1) return null;

  const code = yearCode.toUpperCase();
  // Cycles: 1980–2009, 2010–2039, 2040–2069, …
  const cycles = [1980, 2010, 2040, 2070];
  const candidates: number[] = [];
  for (const start of cycles) {
    const year = yearForCode(code, start);
    if (year != null && year <= currentYear + 1) {
      candidates.push(year);
    }
  }

  if (candidates.length === 0) return null;
  return Math.max(...candidates);
}
