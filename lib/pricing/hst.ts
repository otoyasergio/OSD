/**
 * Ontario Harmonized Sales Tax for Toronto Moto / OTOMOTO Service.
 * Shop prices (jobs, parts) are pre-tax; HST is added on merchandise subtotals.
 */
export const HST_RATE = 0.13;

export const HST_PERCENT = 13;

export const HST_LINE_NAME = "HST (13%)";

export type HstBreakdownDollars = {
  subtotal: number;
  hst: number;
  total: number;
};

export type HstBreakdownCents = {
  subtotalCents: number;
  hstCents: number;
  totalCents: number;
};

/** Round to cents as dollars (2 decimal places). */
export function roundMoney(amount: number): number {
  return Math.round(amount * 100) / 100;
}

/** HST dollars on a pre-tax subtotal. */
export function hstAmount(subtotal: number, rate: number = HST_RATE): number {
  if (!Number.isFinite(subtotal) || subtotal <= 0) return 0;
  return roundMoney(subtotal * rate);
}

/** Subtotal + HST breakdown in dollars. */
export function withHst(subtotal: number, rate: number = HST_RATE): HstBreakdownDollars {
  const safe = Number.isFinite(subtotal) && subtotal > 0 ? roundMoney(subtotal) : 0;
  const hst = hstAmount(safe, rate);
  return { subtotal: safe, hst, total: roundMoney(safe + hst) };
}

/** HST cents on a pre-tax subtotal in cents. */
export function hstCentsOn(subtotalCents: number, rate: number = HST_RATE): number {
  if (!Number.isFinite(subtotalCents) || subtotalCents <= 0) return 0;
  return Math.round(subtotalCents * rate);
}

/** Subtotal + HST breakdown in cents. */
export function withHstCents(
  subtotalCents: number,
  rate: number = HST_RATE
): HstBreakdownCents {
  const safe =
    Number.isFinite(subtotalCents) && subtotalCents > 0 ? Math.round(subtotalCents) : 0;
  const hstCents = hstCentsOn(safe, rate);
  return {
    subtotalCents: safe,
    hstCents,
    totalCents: safe + hstCents,
  };
}

/**
 * Pre-tax merchandise dollars → cents breakdown with Ontario HST.
 * Use for estimate / remaining totals shown in the app.
 */
export function estimateTotalsWithHst(
  merchandiseDollars: number,
  rate: number = HST_RATE
): HstBreakdownCents {
  const subtotalCents = Math.round(
    (Number.isFinite(merchandiseDollars) ? merchandiseDollars : 0) * 100
  );
  return withHstCents(subtotalCents, rate);
}

type NamedAmount = { name: string; amount: number };

/**
 * Append a single HST line to billable lines (Square draft/invoice).
 * No-op when merchandise subtotal is zero.
 */
export function appendHstLine<T extends NamedAmount>(
  lines: T[],
  rate: number = HST_RATE
): Array<T | { name: string; amount: number }> {
  const subtotal = lines.reduce((sum, line) => sum + Number(line.amount ?? 0), 0);
  const hst = hstAmount(subtotal, rate);
  if (hst <= 0) return lines;
  return [...lines, { name: HST_LINE_NAME, amount: hst }];
}
