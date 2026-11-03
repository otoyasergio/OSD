import { createHash } from "node:crypto";
import type { AuctionLotRecord, AuctionLotStatus } from "@/lib/auctions/types";

const MAX_USD = 50_000_000;

export type AltfnMotorcycleRow = {
  item_title?: unknown;
  manufacturer_name?: unknown;
  brand_name?: unknown;
  model?: unknown;
  production_year?: unknown;
  vendor?: unknown;
  sale_price?: unknown;
  sale_currency?: unknown;
  usd_price_decimal?: unknown;
  sale_date?: unknown;
  sale_location?: unknown;
  sale_location_country?: unknown;
  status?: unknown;
  lot_url?: unknown;
};

export function parseAuctionStatus(
  value: unknown,
  priceUsd: number | null
): AuctionLotStatus {
  const status = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!status) return priceUsd != null && priceUsd > 0 ? "sold" : "unknown";
  if (status.includes("withdraw")) return "withdrawn";
  if (
    status.includes("unsold") ||
    status.includes("bought in") ||
    status.includes("bought-in") ||
    status.includes("passed") ||
    status.includes("reserve not")
  ) {
    return "unsold";
  }
  if (status === "sold" || status.includes("sold")) return "sold";
  return "unknown";
}

export function parseModelYear(value: unknown): number | null {
  const text =
    typeof value === "number" ? String(value) : typeof value === "string" ? value : "";
  const match = text.match(/\b(18|19|20)\d{2}\b/);
  if (!match) return null;
  const year = Number(match[0]);
  if (year < 1885 || year > 2100) return null;
  return year;
}

export function parseSaleDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = value.trim().match(/^(\d{4}-\d{2}-\d{2})/);
  if (!match) return null;
  const [year, month, day] = match[1].split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return match[1];
}

export function parseUsd(value: unknown): number | null {
  if (typeof value === "number") return saneUsd(value);
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/[$,\s]/g, "");
  if (!cleaned) return null;
  return saneUsd(Number(cleaned));
}

function saneUsd(value: number): number | null {
  if (!Number.isFinite(value) || value <= 0 || value > MAX_USD) return null;
  return Math.round(value * 100) / 100;
}

export function parseMoneyAmount(value: unknown): number | null {
  return parseUsd(value);
}

export function safeHttpUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 1000) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

function text(value: unknown, max: number): string {
  if (typeof value !== "string" && typeof value !== "number") return "";
  return String(value).replace(/\s+/g, " ").trim().slice(0, max);
}

function currency(value: unknown): string | null {
  const code = text(value, 8).toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : null;
}

export function auctionSourceLotId(source: string, parts: string[]): string {
  return createHash("sha256")
    .update([source, ...parts].join("|"))
    .digest("hex");
}

export function mapAltfnMotorcycleRow(
  row: AltfnMotorcycleRow,
  source = "altfndata"
): AuctionLotRecord | null {
  const make = text(row.manufacturer_name, 80) || text(row.brand_name, 80);
  const model = text(row.model, 120);
  const modelYear = parseModelYear(row.production_year);
  const priceUsd = parseUsd(row.usd_price_decimal);
  const hammerCurrency = currency(row.sale_currency);
  const hammerAmount = parseMoneyAmount(row.sale_price);
  const title =
    text(row.item_title, 300) ||
    [modelYear, make, model].filter(Boolean).join(" ").trim();
  if (!make || !title) return null;

  const saleDate = parseSaleDate(row.sale_date);
  const vendor = text(row.vendor, 120) || null;
  const lotUrl = safeHttpUrl(row.lot_url);
  const realized = priceUsd ?? (hammerCurrency === "USD" ? hammerAmount : null);

  return {
    source,
    sourceLotId: auctionSourceLotId(source, [
      lotUrl ?? "",
      title,
      saleDate ?? "",
      realized != null ? String(realized) : "",
      vendor ?? "",
    ]),
    title,
    make,
    model,
    modelYear,
    vendor,
    saleDate,
    status: parseAuctionStatus(row.status, realized),
    priceUsd: realized,
    hammerAmount,
    hammerCurrency,
    location: text(row.sale_location, 120) || null,
    country: text(row.sale_location_country, 80) || null,
    lotUrl,
  };
}

export type AltfnProviderFetch = {
  configured: boolean;
  lots: AuctionLotRecord[];
  message: string | null;
  failed: boolean;
};

type FetchLike = typeof fetch;

export async function fetchAltfnMotorcycleLots(args: {
  make: string;
  model: string;
  apiKey: string | undefined;
  baseUrl?: string;
  makeProbe: string | null;
  modelProbe: string | null;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}): Promise<AltfnProviderFetch> {
  const apiKey = args.apiKey?.trim();
  if (!apiKey) {
    return { configured: false, lots: [], message: null, failed: false };
  }

  const fetchImpl = args.fetchImpl ?? fetch;
  const base = (args.baseUrl?.trim() || "https://api.altfndata.com").replace(/\/$/, "");
  const timeoutMs = args.timeoutMs ?? 12_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const [valuation, queried] = await Promise.all([
      postValuation(fetchImpl, base, apiKey, args.make, args.model, controller.signal),
      queryLots(
        fetchImpl,
        base,
        apiKey,
        args.makeProbe,
        args.modelProbe,
        controller.signal
      ),
    ]);
    const failures = [valuation.message, queried.message].filter(Boolean);
    const lots = [...valuation.lots, ...queried.lots];
    return {
      configured: true,
      lots,
      failed: lots.length === 0 && failures.length > 0,
      message: failures[0] ?? null,
    };
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    return {
      configured: true,
      lots: [],
      failed: true,
      message: aborted
        ? "ALT/FNDATA did not respond in time."
        : "ALT/FNDATA could not be reached.",
    };
  } finally {
    clearTimeout(timer);
  }
}

const QUERY_FIELDS = [
  "item_title",
  "manufacturer_name",
  "brand_name",
  "model",
  "production_year",
  "vendor",
  "sale_price",
  "sale_currency",
  "usd_price_decimal",
  "sale_date",
  "sale_location",
  "sale_location_country",
  "status",
  "lot_url",
];

async function queryLots(
  fetchImpl: FetchLike,
  base: string,
  apiKey: string,
  makeProbe: string | null,
  modelProbe: string | null,
  signal: AbortSignal
): Promise<{ lots: AuctionLotRecord[]; message: string | null }> {
  if (!makeProbe) return { lots: [], message: null };
  const filters: { field: string; op: string; value: string | number }[] = [
    { field: "manufacturer_name", op: "like", value: makeProbe },
    { field: "usd_price_decimal", op: "gt", value: 0 },
  ];
  if (modelProbe) {
    filters.push({ field: "model", op: "like", value: modelProbe });
  }

  const primary = await altfnQuery(fetchImpl, base, apiKey, signal, filters);
  if (primary.message && primary.lots.length === 0) return primary;
  if (!modelProbe || primary.lots.length >= 8) return primary;

  const byTitle = await altfnQuery(fetchImpl, base, apiKey, signal, [
    { field: "manufacturer_name", op: "like", value: makeProbe },
    { field: "item_title", op: "like", value: modelProbe },
    { field: "usd_price_decimal", op: "gt", value: 0 },
  ]);
  return {
    lots: [...primary.lots, ...byTitle.lots],
    message: byTitle.message ?? primary.message,
  };
}

async function altfnQuery(
  fetchImpl: FetchLike,
  base: string,
  apiKey: string,
  signal: AbortSignal,
  filters: { field: string; op: string; value: string | number }[]
): Promise<{ lots: AuctionLotRecord[]; message: string | null }> {
  const response = await fetchImpl(`${base}/v1/tables/motorcycle/query`, {
    method: "POST",
    signal,
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
    },
    body: JSON.stringify({
      fields: QUERY_FIELDS,
      filters,
      sort: [{ field: "sale_date", direction: "desc" }],
      limit: 100,
      offset: 0,
    }),
  });
  const body = await readJson(response);
  if (!response.ok) {
    return { lots: [], message: providerErrorMessage(response.status, body) };
  }
  const rows = extractRows(body);
  return {
    lots: rows.flatMap((row) => {
      const mapped = mapAltfnMotorcycleRow(row);
      return mapped ? [mapped] : [];
    }),
    message: null,
  };
}

async function postValuation(
  fetchImpl: FetchLike,
  base: string,
  apiKey: string,
  make: string,
  model: string,
  signal: AbortSignal
): Promise<{ lots: AuctionLotRecord[]; message: string | null }> {
  const response = await fetchImpl(`${base}/v1/valuation`, {
    method: "POST",
    signal,
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
    },
    body: JSON.stringify({
      category: "motorcycles",
      brand: make,
      model,
    }),
  });
  const body = await readJson(response);
  if (response.status === 403) {
    return { lots: [], message: null };
  }
  if (!response.ok) {
    return { lots: [], message: providerErrorMessage(response.status, body) };
  }
  if (!body || typeof body !== "object") return { lots: [], message: null };
  const record = body as Record<string, unknown>;
  if (record.ok === false) return { lots: [], message: null };
  const comps = Array.isArray(record.comps) ? record.comps : [];
  const lots = comps.flatMap((comp) => {
    if (!comp || typeof comp !== "object") return [];
    const row = comp as Record<string, unknown>;
    const mapped = mapAltfnMotorcycleRow({
      item_title: row.item_title ?? row.title ?? row.model,
      manufacturer_name: row.manufacturer_name ?? row.brand ?? make,
      model: row.model ?? model,
      production_year: row.production_year ?? row.year,
      vendor: row.vendor,
      usd_price_decimal: row.usd_price ?? row.usd_price_decimal ?? row.price,
      sale_currency: "USD",
      sale_date: row.sale_date,
      sale_location: row.sale_location,
      sale_location_country: row.sale_location_country,
      status: row.status ?? "sold",
      lot_url: row.lot_url,
    });
    return mapped ? [mapped] : [];
  });
  return { lots, message: null };
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function extractRows(body: unknown): AltfnMotorcycleRow[] {
  if (Array.isArray(body)) return body as AltfnMotorcycleRow[];
  if (!body || typeof body !== "object") return [];
  const record = body as Record<string, unknown>;
  if (Array.isArray(record.data)) return record.data as AltfnMotorcycleRow[];
  if (Array.isArray(record.rows)) return record.rows as AltfnMotorcycleRow[];
  return [];
}

export function providerErrorMessage(status: number, body: unknown): string {
  if (status === 401 || status === 403) {
    return "ALT/FNDATA rejected the API key or the motorcycle table is not on this key.";
  }
  if (status === 429) return "ALT/FNDATA rate limit reached. Try the update again later.";
  const detail =
    body && typeof body === "object" && "detail" in body
      ? String((body as { detail: unknown }).detail)
      : "";
  if (detail && !detail.toLowerCase().includes("key")) {
    return `ALT/FNDATA returned ${status}.`;
  }
  return `ALT/FNDATA returned ${status}.`;
}
