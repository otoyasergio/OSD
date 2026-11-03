export type AuctionLotStatus = "sold" | "unsold" | "withdrawn" | "unknown";

export type BikeIdentity = {
  year: number;
  make: string;
  model: string;
};

/**
 * Normalized realized (or offered) auction lot.
 * `priceUsd` stays in US dollars. The price guide converts it to Canadian dollars.
 */
export type AuctionLotRecord = {
  source: string;
  sourceLotId: string;
  title: string;
  make: string;
  model: string;
  modelYear: number | null;
  vendor: string | null;
  saleDate: string | null;
  status: AuctionLotStatus;
  priceUsd: number | null;
  hammerAmount: number | null;
  hammerCurrency: string | null;
  location: string | null;
  country: string | null;
  lotUrl: string | null;
};

export type AuctionHistoryPoint = {
  saleYear: number;
  medianCad: number;
  count: number;
};

export type AuctionCompView = {
  title: string;
  modelYear: number | null;
  vendor: string | null;
  saleDate: string | null;
  priceCad: number;
  place: string | null;
  lotUrl: string | null;
  sourceId: string;
  sourceName: string;
};

/** How stored US-dollar auction results were turned into Canadian dollars. */
export type AuctionFxNote = {
  source: "bank-of-canada" | "fallback";
  label: string;
};

export type AuctionGuideState =
  "ready" | "empty" | "not_configured" | "unavailable" | "error";

export type ModelYearScope = "model_year" | "nearby_year" | "all_years" | "none";

/**
 * Audience-neutral facts stored on the motorcycle. Headlines are rendered
 * later so a staff refresh cannot leak setup instructions into the portal.
 */
export type StoredAuctionGuide = {
  state: AuctionGuideState;
  make: string;
  model: string;
  year: number;
  modelYearScope: ModelYearScope;
  modelYearCount: number;
  modelYearMedianCad: number | null;
  modelYearLowCad: number | null;
  modelYearHighCad: number | null;
  nearbySpan: number | null;
  overallCount: number;
  overallMedianCad: number | null;
  overallLowCad: number | null;
  overallHighCad: number | null;
  fx: AuctionFxNote;
  earliestSaleYear: number | null;
  latestSaleYear: number | null;
  truncated: boolean;
  history: AuctionHistoryPoint[];
  comps: AuctionCompView[];
  sourceIds: string[];
  fixturePreview: boolean;
  altfnConfigured: boolean;
  providerMessage: string | null;
  fetchedAt: string | null;
};

export type AuctionSourceConnection = "connected" | "import" | "not_connected";

export type ResearchedAuctionSource = {
  id: string;
  name: string;
  covers: string;
  connection: AuctionSourceConnection;
  connectionLabel: string;
};

export type AuctionPriceGuideView = StoredAuctionGuide & {
  audience: "staff" | "customer";
  headline: string;
  detail: string;
  disclaimer: string;
  historyNote: string | null;
  visibleHistory: AuctionHistoryPoint[];
  sourceLine: string;
  researchedSources: ResearchedAuctionSource[];
  appraisalNote: string;
};
