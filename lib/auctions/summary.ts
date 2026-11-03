import { auctionFxNote, fallbackUsdCadRateBook, usdToCad } from "@/lib/auctions/cad";
import { auctionLotMatchesBike } from "@/lib/auctions/match";
import {
  APPRAISAL_GUIDES_NOTE,
  auctionSourceName,
  researchedAuctionSources,
} from "@/lib/auctions/sources";
import type {
  AuctionCompView,
  AuctionGuideState,
  AuctionHistoryPoint,
  AuctionLotRecord,
  AuctionPriceGuideView,
  BikeIdentity,
  ModelYearScope,
  StoredAuctionGuide,
} from "@/lib/auctions/types";

export const AUCTION_GUIDE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const AUCTION_LOT_READ_LIMIT = 400;
export const AUCTION_HISTORY_VISIBLE = 16;
const MAX_COMPS = 12;
const MAX_SANE_USD = 50_000_000;

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

export function formatCad(amount: number): string {
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatSaleDate(iso: string | null): string {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return "";
  const [year, month, day] = iso.split("-").map(Number);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "UTC",
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

export type AuctionRefreshPlan =
  "use-snapshot" | "rebuild-local" | "await-provider" | "snapshot-and-refresh";

export function planAuctionRefresh(args: {
  force: boolean;
  hasKey: boolean;
  snapshotMatches: boolean;
  /** True when the cached guide was built with an API key. */
  snapshotConfigured: boolean;
  snapshotAgeMs: number | null;
  localSaleCount: number;
  snapshotSaleCount: number | null;
  ttlMs: number;
}): AuctionRefreshPlan {
  if (args.force) return args.hasKey ? "await-provider" : "rebuild-local";
  if (!args.snapshotMatches) return args.hasKey ? "await-provider" : "rebuild-local";
  if (args.hasKey && !args.snapshotConfigured) return "await-provider";
  if (!args.hasKey && args.snapshotConfigured) return "rebuild-local";

  const stale = args.snapshotAgeMs == null || args.snapshotAgeMs >= args.ttlMs;
  const countDrift =
    args.snapshotSaleCount == null || args.localSaleCount !== args.snapshotSaleCount;

  if (!stale && !countDrift) return "use-snapshot";
  if (!stale && countDrift) return "rebuild-local";
  if (stale && args.hasKey) return "snapshot-and-refresh";
  return "rebuild-local";
}

function isPricedSale(
  lot: AuctionLotRecord
): lot is AuctionLotRecord & { priceUsd: number } {
  return (
    lot.status === "sold" &&
    lot.priceUsd != null &&
    lot.priceUsd > 0 &&
    lot.priceUsd <= MAX_SANE_USD
  );
}

function dedupeLots(lots: AuctionLotRecord[]): AuctionLotRecord[] {
  const seen = new Set<string>();
  const unique: AuctionLotRecord[] = [];
  for (const lot of lots) {
    const key = lot.lotUrl ? `url:${lot.lotUrl}` : `id:${lot.source}:${lot.sourceLotId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(lot);
  }
  return unique;
}

function range(values: number[]): { low: number; high: number } | null {
  if (values.length === 0) return null;
  return { low: Math.min(...values), high: Math.max(...values) };
}

function saleCad(
  lot: AuctionLotRecord & { priceUsd: number },
  cadPerUsd: (saleDate: string | null) => number
): number {
  return usdToCad(lot.priceUsd, cadPerUsd(lot.saleDate));
}

function historyFrom(
  lots: Array<AuctionLotRecord & { priceUsd: number }>,
  cadPerUsd: (saleDate: string | null) => number
): AuctionHistoryPoint[] {
  const byYear = new Map<number, number[]>();
  for (const lot of lots) {
    if (!lot.saleDate) continue;
    const year = Number(lot.saleDate.slice(0, 4));
    if (!Number.isInteger(year)) continue;
    const prices = byYear.get(year) ?? [];
    prices.push(saleCad(lot, cadPerUsd));
    byYear.set(year, prices);
  }
  return [...byYear.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([saleYear, prices]) => ({
      saleYear,
      medianCad: median(prices) ?? prices[0],
      count: prices.length,
    }));
}

function compFrom(
  lot: AuctionLotRecord & { priceUsd: number },
  cadPerUsd: (saleDate: string | null) => number
): AuctionCompView {
  const place = [lot.location, lot.country].filter(Boolean).join(", ") || null;
  return {
    title: lot.title,
    modelYear: lot.modelYear,
    vendor: lot.vendor,
    saleDate: lot.saleDate,
    priceCad: saleCad(lot, cadPerUsd),
    place,
    lotUrl: lot.lotUrl,
    sourceId: lot.source,
    sourceName: auctionSourceName(lot.source),
  };
}

export function unavailableStoredGuide(bike: BikeIdentity): StoredAuctionGuide {
  return {
    state: "unavailable",
    make: bike.make,
    model: bike.model,
    year: bike.year,
    modelYearScope: "none",
    modelYearCount: 0,
    modelYearMedianCad: null,
    modelYearLowCad: null,
    modelYearHighCad: null,
    nearbySpan: null,
    overallCount: 0,
    overallMedianCad: null,
    overallLowCad: null,
    overallHighCad: null,
    fx: auctionFxNote(fallbackUsdCadRateBook()),
    earliestSaleYear: null,
    latestSaleYear: null,
    truncated: false,
    history: [],
    comps: [],
    sourceIds: [],
    fixturePreview: false,
    altfnConfigured: false,
    providerMessage: null,
    fetchedAt: null,
  };
}

export function buildStoredAuctionGuide(args: {
  bike: BikeIdentity;
  lots: AuctionLotRecord[];
  truncated: boolean;
  altfnConfigured: boolean;
  providerMessage: string | null;
  fetchedAt: string | null;
  providerFailed: boolean;
  cadPerUsd: (saleDate: string | null) => number;
  fx: StoredAuctionGuide["fx"];
}): StoredAuctionGuide {
  const matched = dedupeLots(args.lots).filter((lot) =>
    auctionLotMatchesBike(args.bike, lot)
  );
  const sold = matched.filter(isPricedSale);
  const prices = sold.map((lot) => saleCad(lot, args.cadPerUsd));
  const overall = range(prices);
  const history = historyFrom(sold, args.cadPerUsd);
  const saleYears = history.map((point) => point.saleYear);

  const exact = sold.filter((lot) => lot.modelYear === args.bike.year);
  const nearby =
    exact.length >= 2
      ? exact
      : sold.filter(
          (lot) => lot.modelYear != null && Math.abs(lot.modelYear - args.bike.year) <= 1
        );

  let modelYearScope: ModelYearScope = "none";
  let slice = sold;
  let nearbySpan: number | null = null;
  if (exact.length >= 2) {
    modelYearScope = "model_year";
    slice = exact;
  } else if (nearby.length >= 2) {
    modelYearScope = "nearby_year";
    slice = nearby;
    nearbySpan = 1;
  } else if (sold.length >= 2) {
    modelYearScope = "all_years";
    slice = sold;
  } else if (sold.length === 1) {
    modelYearScope = exact.length === 1 ? "model_year" : "all_years";
    slice = sold;
  }

  const slicePrices = slice.map((lot) => saleCad(lot, args.cadPerUsd));
  const sliceRange = range(slicePrices);
  const sourceIds = [...new Set(sold.map((lot) => lot.source))];
  const fixturePreview = sold.length > 0 && sold.every((lot) => lot.source === "fixture");

  let state: AuctionGuideState;
  if (args.providerFailed && sold.length === 0) state = "error";
  else if (sold.length > 0) state = "ready";
  else if (args.altfnConfigured) state = "empty";
  else state = "not_configured";

  const comps = [...sold]
    .sort((a, b) => (b.saleDate ?? "").localeCompare(a.saleDate ?? ""))
    .slice(0, MAX_COMPS)
    .map((lot) => compFrom(lot, args.cadPerUsd));

  return {
    state,
    make: args.bike.make,
    model: args.bike.model,
    year: args.bike.year,
    modelYearScope,
    modelYearCount: slice.length,
    modelYearMedianCad: median(slicePrices),
    modelYearLowCad: sliceRange?.low ?? null,
    modelYearHighCad: sliceRange?.high ?? null,
    nearbySpan,
    overallCount: sold.length,
    overallMedianCad: median(prices),
    overallLowCad: overall?.low ?? null,
    overallHighCad: overall?.high ?? null,
    earliestSaleYear: saleYears[0] ?? null,
    latestSaleYear: saleYears[saleYears.length - 1] ?? null,
    truncated: args.truncated,
    history,
    comps,
    sourceIds,
    fixturePreview,
    altfnConfigured: args.altfnConfigured,
    providerMessage: args.providerMessage,
    fetchedAt: args.fetchedAt,
    fx: args.fx,
  };
}

export function presentAuctionPriceGuide(
  stored: StoredAuctionGuide,
  audience: "staff" | "customer"
): AuctionPriceGuideView {
  const bike = `${stored.year} ${stored.make} ${stored.model}`;
  const copy = guideCopy(stored, audience, bike);
  const visibleHistory = stored.history.slice(-AUCTION_HISTORY_VISIBLE);
  const hiddenYears = stored.history.length - visibleHistory.length;

  return {
    ...stored,
    audience,
    headline: copy.headline,
    detail: copy.detail,
    disclaimer:
      stored.state === "ready"
        ? `Prices are in Canadian dollars. US auction results are converted using ${stored.fx.label}. Use them as a rough comparison of what similar motorcycles sold for. Condition, mileage, and local retail prices sit outside this list.`
        : "",
    historyNote:
      hiddenYears > 0
        ? `Earlier sale years are included in the typical price. The latest ${visibleHistory.length} years are listed.`
        : null,
    visibleHistory,
    sourceLine: sourceLine(stored),
    researchedSources: researchedAuctionSources(stored.altfnConfigured),
    appraisalNote: APPRAISAL_GUIDES_NOTE,
  };
}

function sourceLine(stored: StoredAuctionGuide): string {
  if (stored.sourceIds.length === 0) {
    return stored.altfnConfigured
      ? "Searched ALT/FNDATA motorcycle auctions."
      : "No auction file is loaded yet.";
  }
  const names = stored.sourceIds.map(auctionSourceName);
  return `Sold prices from ${names.join(", ")}, in Canadian dollars.`;
}

function guideCopy(
  stored: StoredAuctionGuide,
  audience: "staff" | "customer",
  bike: string
): { headline: string; detail: string } {
  if (stored.state === "unavailable") {
    return {
      headline: "Auction price guide is unavailable",
      detail:
        audience === "staff"
          ? "The auction tables are not on this database yet."
          : "Auction prices are not available right now.",
    };
  }

  if (stored.state === "error") {
    return {
      headline: "Auction prices could not be loaded",
      detail:
        audience === "staff"
          ? (stored.providerMessage ?? "The auction provider returned an error.")
          : "Auction prices could not be loaded right now. Ask the shop to refresh them.",
    };
  }

  if (stored.state === "not_configured") {
    return audience === "staff"
      ? {
          headline: "Auction price guide is not connected",
          detail:
            "Set ALTFNDATA_API_KEY for the ALT/FNDATA motorcycle feed, the same dataset as the AWS Data Exchange listing. A JSON or CSV export can also be imported with npm run import:auction-lots.",
        }
      : {
          headline: "Auction prices are not available yet",
          detail: "The shop has not loaded past auction sales for this motorcycle.",
        };
  }

  if (stored.state === "empty" || stored.overallCount === 0) {
    return {
      headline: "No matching auction sales yet",
      detail: `Collector and specialty auctions have no sold match on file for a ${bike}.`,
    };
  }

  if (stored.overallCount === 1 && stored.overallMedianCad != null) {
    return {
      headline: `${formatCad(stored.overallMedianCad)} is the only matching auction sale on file`,
      detail: `One sale is a thin guide for a ${bike}.`,
    };
  }

  const medianText =
    stored.modelYearMedianCad != null ? formatCad(stored.modelYearMedianCad) : "";
  const band =
    stored.modelYearLowCad != null && stored.modelYearHighCad != null
      ? `${formatCad(stored.modelYearLowCad)} to ${formatCad(stored.modelYearHighCad)}`
      : "";
  const span =
    stored.earliestSaleYear && stored.latestSaleYear
      ? `${stored.earliestSaleYear} to ${stored.latestSaleYear}`
      : "the years on file";

  if (stored.modelYearScope === "model_year" && stored.modelYearMedianCad != null) {
    const across =
      stored.overallCount > stored.modelYearCount && stored.overallMedianCad != null
        ? ` Across ${stored.overallCount} sales of this model, the middle price is ${formatCad(stored.overallMedianCad)}.`
        : "";
    return {
      headline: `${medianText} typical auction price for the ${stored.year} model year`,
      detail: `${stored.modelYearCount} recorded ${stored.modelYearCount === 1 ? "sale" : "sales"} of the ${bike} sold for ${band}.${across}`,
    };
  }

  if (stored.modelYearScope === "nearby_year" && stored.modelYearMedianCad != null) {
    return {
      headline: `${medianText} typical auction price within one model year of ${stored.year}`,
      detail: `${stored.modelYearCount} sales from ${stored.year - 1} to ${stored.year + 1} sold for ${band}. The ${stored.year} model year alone has fewer than two sales.`,
    };
  }

  return {
    headline: `${formatCad(stored.overallMedianCad ?? 0)} typical auction price for this model`,
    detail: `${stored.overallCount} auction sales from ${span}, ranging from ${formatCad(stored.overallLowCad ?? 0)} to ${formatCad(stored.overallHighCad ?? 0)}. The ${stored.year} model year alone has fewer than two sales, so this mixes model years.`,
  };
}
