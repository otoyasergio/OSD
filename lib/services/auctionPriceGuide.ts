import { fetchAltfnMotorcycleLots } from "@/lib/auctions/altfndata";
import {
  auctionSearchText,
  makeKey,
  makeProbe,
  modelProbe,
  requiredModelTokens,
} from "@/lib/auctions/match";
import { parseStoredAuctionGuide } from "@/lib/auctions/schema";
import {
  AUCTION_GUIDE_TTL_MS,
  AUCTION_LOT_READ_LIMIT,
  buildStoredAuctionGuide,
  planAuctionRefresh,
  presentAuctionPriceGuide,
  unavailableStoredGuide,
} from "@/lib/auctions/summary";
import type {
  AuctionLotRecord,
  AuctionPriceGuideView,
  BikeIdentity,
  StoredAuctionGuide,
} from "@/lib/auctions/types";
import { isUndefinedTableError } from "@/lib/database/schemaCompat";
import { createAuctionAdminClient } from "@/lib/database/supabase-admin";

type Audience = "staff" | "customer";

export type LoadedAuctionGuide = {
  view: AuctionPriceGuideView;
  refreshInBackground: boolean;
};

type LotRow = {
  source: string;
  source_lot_id: string;
  title: string;
  make: string;
  model: string;
  model_year: number | null;
  vendor: string | null;
  sale_date: string | null;
  status: AuctionLotRecord["status"];
  price_usd_cents: number | string | null;
  hammer_amount_cents: number | string | null;
  hammer_currency: string | null;
  location: string | null;
  country: string | null;
  lot_url: string | null;
};

function altfnSettings(env: Record<string, string | undefined>) {
  return {
    apiKey: env.ALTFNDATA_API_KEY?.trim() || undefined,
    baseUrl: env.ALTFNDATA_API_BASE_URL?.trim() || undefined,
  };
}

function centsToDollars(value: number | string | null): number | null {
  if (value == null) return null;
  const amount = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return Math.round(amount) / 100;
}

function dollarsToCents(amount: number | null): number | null {
  if (amount == null) return null;
  return Math.round(amount * 100);
}

function rowToLot(row: LotRow): AuctionLotRecord {
  return {
    source: row.source,
    sourceLotId: row.source_lot_id,
    title: row.title,
    make: row.make,
    model: row.model,
    modelYear: row.model_year,
    vendor: row.vendor,
    saleDate: row.sale_date,
    status: row.status,
    priceUsd: centsToDollars(row.price_usd_cents),
    hammerAmount: centsToDollars(row.hammer_amount_cents),
    hammerCurrency: row.hammer_currency,
    location: row.location,
    country: row.country,
    lotUrl: row.lot_url,
  };
}

function lotToRow(lot: AuctionLotRecord) {
  return {
    source: lot.source,
    source_lot_id: lot.sourceLotId,
    title: lot.title.slice(0, 400),
    make: lot.make.slice(0, 80),
    make_key: makeKey(lot.make),
    model: lot.model.slice(0, 120),
    model_year: lot.modelYear,
    vendor: lot.vendor,
    sale_date: lot.saleDate,
    status: lot.status,
    price_usd_cents: dollarsToCents(lot.priceUsd),
    hammer_amount_cents: dollarsToCents(lot.hammerAmount),
    hammer_currency: lot.hammerCurrency,
    location: lot.location,
    country: lot.country,
    lot_url: lot.lotUrl,
    search_text: auctionSearchText(lot),
    imported_at: new Date().toISOString(),
  };
}

function missingTable(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (isUndefinedTableError(error)) return true;
  if (error.code === "PGRST205") return true;
  const message = (error.message ?? "").toLowerCase();
  return message.includes("auction_lot") || message.includes("auction_price_snapshot");
}

export async function upsertAuctionLots(lots: AuctionLotRecord[]): Promise<number> {
  const unique = new Map<string, AuctionLotRecord>();
  for (const lot of lots) {
    if (!lot.make.trim() || !lot.title.trim()) continue;
    unique.set(`${lot.source}:${lot.sourceLotId}`, lot);
  }
  const rows = [...unique.values()].map(lotToRow);
  if (rows.length === 0) return 0;

  const admin = createAuctionAdminClient();
  for (let index = 0; index < rows.length; index += 100) {
    const chunk = rows.slice(index, index + 100);
    const { error } = await admin.from("auction_lot").upsert(chunk, {
      onConflict: "source,source_lot_id",
    });
    if (error) throw error;
  }
  return rows.length;
}

async function readMatchingLots(bike: BikeIdentity): Promise<{
  lots: AuctionLotRecord[];
  truncated: boolean;
}> {
  const tokens = requiredModelTokens(bike.model, bike.make);
  const key = makeKey(bike.make);
  if (!key || tokens.length === 0) return { lots: [], truncated: false };

  const admin = createAuctionAdminClient();
  let query = admin
    .from("auction_lot")
    .select(
      "source, source_lot_id, title, make, model, model_year, vendor, sale_date, status, price_usd_cents, hammer_amount_cents, hammer_currency, location, country, lot_url"
    )
    .eq("make_key", key)
    .eq("status", "sold")
    .not("price_usd_cents", "is", null)
    .order("sale_date", { ascending: false })
    .limit(AUCTION_LOT_READ_LIMIT);

  for (const token of tokens) {
    query = query.ilike("search_text", `%${token.replace(/[%_]/g, "")}%`);
  }

  const { data, error } = await query;
  if (error) throw error;
  const rows = (data ?? []) as LotRow[];
  return {
    lots: rows.map(rowToLot),
    truncated: rows.length >= AUCTION_LOT_READ_LIMIT,
  };
}

async function readSnapshot(motorcycleId: string): Promise<{
  guide: StoredAuctionGuide;
  fetchedAt: string;
} | null> {
  const admin = createAuctionAdminClient();
  const { data, error } = await admin
    .from("auction_price_snapshot")
    .select("guide, fetched_at, year, make, model")
    .eq("motorcycle_id", motorcycleId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const guide = parseStoredAuctionGuide(data.guide);
  if (!guide) return null;
  return { guide, fetchedAt: data.fetched_at as string };
}

async function writeSnapshot(
  motorcycleId: string,
  bike: BikeIdentity,
  guide: StoredAuctionGuide
): Promise<void> {
  const admin = createAuctionAdminClient();
  const { error } = await admin.from("auction_price_snapshot").upsert({
    motorcycle_id: motorcycleId,
    year: bike.year,
    make: bike.make,
    model: bike.model,
    guide,
    provider_status: guide.state,
    provider_message: guide.providerMessage,
    fetched_at: guide.fetchedAt ?? new Date().toISOString(),
  });
  if (error) throw error;
}

export async function loadAuctionPriceGuide(args: {
  motorcycleId: string;
  bike: BikeIdentity;
  audience: Audience;
  refresh?: "auto" | "force";
  env?: Record<string, string | undefined>;
  now?: number;
}): Promise<LoadedAuctionGuide> {
  const audience = args.audience;
  const refresh = args.refresh ?? "auto";
  const env = args.env ?? process.env;
  const now = args.now ?? Date.now();

  try {
    const settings = altfnSettings(env);
    const snapshot = await readSnapshot(args.motorcycleId);
    const local = await readMatchingLots(args.bike);
    const snapshotMatches = Boolean(
      snapshot &&
      snapshot.guide.year === args.bike.year &&
      snapshot.guide.make === args.bike.make &&
      snapshot.guide.model === args.bike.model
    );
    const snapshotAgeMs = snapshot ? now - Date.parse(snapshot.fetchedAt) : null;
    const plan = planAuctionRefresh({
      force: refresh === "force",
      hasKey: Boolean(settings.apiKey),
      snapshotMatches,
      snapshotConfigured: snapshotMatches ? snapshot!.guide.altfnConfigured : false,
      snapshotAgeMs: Number.isFinite(snapshotAgeMs) ? snapshotAgeMs : null,
      localSaleCount: countPricedMatches(args.bike, local.lots),
      snapshotSaleCount: snapshotMatches ? snapshot!.guide.overallCount : null,
      ttlMs: AUCTION_GUIDE_TTL_MS,
    });

    if (plan === "use-snapshot" && snapshot) {
      return {
        view: presentAuctionPriceGuide(snapshot.guide, audience),
        refreshInBackground: false,
      };
    }

    if (plan === "snapshot-and-refresh" && snapshot) {
      return {
        view: presentAuctionPriceGuide(snapshot.guide, audience),
        refreshInBackground: true,
      };
    }

    let lots = local.lots;
    let truncated = local.truncated;
    let providerMessage: string | null = null;
    let providerFailed = false;

    if (plan === "await-provider") {
      const fetched = await fetchAltfnMotorcycleLots({
        make: args.bike.make,
        model: args.bike.model,
        apiKey: settings.apiKey,
        baseUrl: settings.baseUrl,
        makeProbe: makeProbe(args.bike.make),
        modelProbe: modelProbe(args.bike.model, args.bike.make),
      });
      providerMessage = fetched.message;
      providerFailed = fetched.failed;
      if (fetched.lots.length > 0) {
        await upsertAuctionLots(fetched.lots);
        const refreshed = await readMatchingLots(args.bike);
        lots = refreshed.lots;
        truncated = refreshed.truncated;
      }
    }

    const stored = buildStoredAuctionGuide({
      bike: args.bike,
      lots,
      truncated,
      altfnConfigured: Boolean(settings.apiKey),
      providerMessage,
      fetchedAt: new Date(now).toISOString(),
      providerFailed,
    });
    await writeSnapshot(args.motorcycleId, args.bike, stored);
    return {
      view: presentAuctionPriceGuide(stored, audience),
      refreshInBackground: false,
    };
  } catch (error) {
    const dbError = error as { code?: string; message?: string };
    if (missingTable(dbError)) {
      return {
        view: presentAuctionPriceGuide(unavailableStoredGuide(args.bike), audience),
        refreshInBackground: false,
      };
    }
    return {
      view: presentAuctionPriceGuide(
        {
          ...unavailableStoredGuide(args.bike),
          state: "error",
          providerMessage: "Auction prices could not be saved.",
        },
        audience
      ),
      refreshInBackground: false,
    };
  }
}

function countPricedMatches(bike: BikeIdentity, lots: AuctionLotRecord[]): number {
  const stored = buildStoredAuctionGuide({
    bike,
    lots,
    truncated: false,
    altfnConfigured: false,
    providerMessage: null,
    fetchedAt: null,
    providerFailed: false,
  });
  return stored.overallCount;
}
