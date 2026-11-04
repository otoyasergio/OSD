import type { AuctionFxNote } from "@/lib/auctions/types";

/** Noon-rate monthly average, Canadian dollars per US dollar, through 2016. */
export const USD_CAD_MONTHLY_SERIES = "IEXM0101";
/** Daily average, Canadian dollars per US dollar, from 3 January 2017. */
export const USD_CAD_DAILY_SERIES = "FXUSDCAD";
export const USD_CAD_DAILY_START = "2017-01-03";

/**
 * Stand-in used only when the Bank of Canada cannot be reached.
 * FXUSDCAD on 2 November 2026 was 1.3978.
 */
export const FALLBACK_CAD_PER_USD = 1.3978;

export type UsdCadObservation = {
  date: string;
  cadPerUsd: number;
};

export type UsdCadRateBook = {
  source: "bank-of-canada" | "fallback";
  observations: UsdCadObservation[];
};

export function fallbackUsdCadRateBook(): UsdCadRateBook {
  return {
    source: "fallback",
    observations: [{ date: "1970-01-01", cadPerUsd: FALLBACK_CAD_PER_USD }],
  };
}

export function parseValetUsdCad(
  payload: unknown,
  seriesName: string
): UsdCadObservation[] {
  if (!payload || typeof payload !== "object") return [];
  const observations = (payload as { observations?: unknown }).observations;
  if (!Array.isArray(observations)) return [];

  const points: UsdCadObservation[] = [];
  for (const row of observations) {
    if (!row || typeof row !== "object") continue;
    const date = (row as { d?: unknown }).d;
    const series = (row as Record<string, unknown>)[seriesName];
    const raw =
      series && typeof series === "object" ? (series as { v?: unknown }).v : undefined;
    const rate =
      typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
    if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    if (!Number.isFinite(rate) || rate <= 0 || rate >= 10) continue;
    points.push({ date, cadPerUsd: rate });
  }
  points.sort((a, b) => a.date.localeCompare(b.date));
  return points;
}

/**
 * Monthly averages cover sales before the daily series begins. A January 2017
 * monthly point is dropped so it cannot override the first daily rate.
 */
export function mergeUsdCadRates(
  monthly: UsdCadObservation[],
  daily: UsdCadObservation[]
): UsdCadRateBook {
  const dailyRates = daily.filter((point) => point.date >= USD_CAD_DAILY_START);
  if (dailyRates.length === 0) return fallbackUsdCadRateBook();
  const observations = [
    ...monthly.filter((point) => point.date < "2017-01-01"),
    ...dailyRates,
  ].sort((a, b) => a.date.localeCompare(b.date));
  return { source: "bank-of-canada", observations };
}

export function cadPerUsdOn(book: UsdCadRateBook, saleDate: string | null): number {
  const observations = book.observations;
  if (observations.length === 0) return FALLBACK_CAD_PER_USD;
  if (!saleDate) return observations[observations.length - 1].cadPerUsd;

  let lo = 0;
  let hi = observations.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (observations[mid].date <= saleDate) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (found < 0) return observations[0].cadPerUsd;
  return observations[found].cadPerUsd;
}

export function usdToCad(usd: number, cadPerUsd: number): number {
  const rate =
    Number.isFinite(cadPerUsd) && cadPerUsd > 0 && cadPerUsd < 10
      ? cadPerUsd
      : FALLBACK_CAD_PER_USD;
  return Math.round(usd * rate);
}

export function auctionFxNote(book: UsdCadRateBook): AuctionFxNote {
  if (book.source === "fallback" || book.observations.length === 0) {
    const rate = book.observations[0]?.cadPerUsd ?? FALLBACK_CAD_PER_USD;
    return {
      source: "fallback",
      label: `an approximate rate of ${rate.toFixed(4)} Canadian dollars per US dollar`,
    };
  }
  const first = book.observations[0].date;
  if (first < "2017-01-01") {
    return {
      source: "bank-of-canada",
      label:
        "the Bank of Canada rate on each sale date. Daily rates are used from 2017, and the monthly average before that",
    };
  }
  const [year, month, day] = first.split("-").map(Number);
  const shown = new Intl.DateTimeFormat("en-CA", {
    timeZone: "UTC",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(new Date(Date.UTC(year, month - 1, day)));
  return {
    source: "bank-of-canada",
    label: `the Bank of Canada daily rate on each sale date. Sales before ${shown} use the rate from that date`,
  };
}
