import { z } from "zod";
import type { StoredAuctionGuide } from "@/lib/auctions/types";

const historyPointSchema = z.object({
  saleYear: z.number(),
  medianCad: z.number(),
  count: z.number(),
});

const compSchema = z.object({
  title: z.string(),
  modelYear: z.number().nullable(),
  vendor: z.string().nullable(),
  saleDate: z.string().nullable(),
  priceCad: z.number(),
  place: z.string().nullable(),
  lotUrl: z.string().nullable(),
  sourceId: z.string(),
  sourceName: z.string(),
});

const fxSchema = z.object({
  source: z.enum(["bank-of-canada", "fallback"]),
  label: z.string().min(1).max(400),
});

export const storedAuctionGuideSchema = z.object({
  state: z.enum(["ready", "empty", "not_configured", "unavailable", "error"]),
  make: z.string(),
  model: z.string(),
  year: z.number(),
  modelYearScope: z.enum(["model_year", "nearby_year", "all_years", "none"]),
  modelYearCount: z.number(),
  modelYearMedianCad: z.number().nullable(),
  modelYearLowCad: z.number().nullable(),
  modelYearHighCad: z.number().nullable(),
  nearbySpan: z.number().nullable(),
  overallCount: z.number(),
  overallMedianCad: z.number().nullable(),
  overallLowCad: z.number().nullable(),
  overallHighCad: z.number().nullable(),
  fx: fxSchema,
  earliestSaleYear: z.number().nullable(),
  latestSaleYear: z.number().nullable(),
  truncated: z.boolean(),
  history: z.array(historyPointSchema),
  comps: z.array(compSchema),
  sourceIds: z.array(z.string()),
  fixturePreview: z.boolean(),
  altfnConfigured: z.boolean(),
  providerMessage: z.string().nullable(),
  fetchedAt: z.string().nullable(),
});

export function parseStoredAuctionGuide(value: unknown): StoredAuctionGuide | null {
  const parsed = storedAuctionGuideSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
