import {
  mapAltfnMotorcycleRow,
  parseAuctionStatus,
  parseModelYear,
  parseSaleDate,
  parseUsd,
  safeHttpUrl,
  auctionSourceLotId,
} from "@/lib/auctions/altfndata";
import type { AuctionLotRecord } from "@/lib/auctions/types";

const SOURCE_SLUG = /^[a-z][a-z0-9_]{0,39}$/;

export function assertAuctionSource(source: string): string {
  const slug = source.trim().toLowerCase();
  if (!SOURCE_SLUG.test(slug)) {
    throw new Error("Source must be a short lowercase slug such as altfndata or iconic.");
  }
  return slug;
}

export function recordsFromAuctionFile(text: string, source: string): AuctionLotRecord[] {
  const slug = assertAuctionSource(source);
  const trimmed = text.replace(/^\uFEFF/, "").trim();
  if (!trimmed) return [];
  const rows =
    trimmed.startsWith("{") || trimmed.startsWith("[")
      ? rowsFromJson(trimmed)
      : rowsFromCsv(trimmed);
  const lots: AuctionLotRecord[] = [];
  for (const row of rows) {
    const mapped = mapAuctionRow(row, slug);
    if (mapped) lots.push(mapped);
  }
  return lots;
}

function rowsFromJson(text: string): Record<string, unknown>[] {
  const parsed = JSON.parse(text) as unknown;
  const list = Array.isArray(parsed)
    ? parsed
    : parsed &&
        typeof parsed === "object" &&
        Array.isArray((parsed as { data?: unknown }).data)
      ? (parsed as { data: unknown[] }).data
      : parsed &&
          typeof parsed === "object" &&
          Array.isArray((parsed as { rows?: unknown }).rows)
        ? (parsed as { rows: unknown[] }).rows
        : null;
  if (!list)
    throw new Error("Auction JSON must be an array of rows, or an object with data.");
  return list.filter(
    (row): row is Record<string, unknown> => Boolean(row) && typeof row === "object"
  );
}

function rowsFromCsv(text: string): Record<string, unknown>[] {
  const table = parseCsv(text);
  if (table.length < 2) return [];
  const headers = table[0].map((header) => header.trim().toLowerCase());
  return table
    .slice(1)
    .filter((cells) => cells.some((cell) => cell.trim()))
    .map((cells) => {
      const row: Record<string, unknown> = {};
      headers.forEach((header, index) => {
        if (header) row[header] = cells[index] ?? "";
      });
      return row;
    });
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
      continue;
    }
    if (char === ",") {
      row.push(cell);
      cell = "";
      continue;
    }
    if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i += 1;
      row.push(cell);
      cell = "";
      if (row.some((value) => value.length > 0)) rows.push(row);
      row = [];
      continue;
    }
    cell += char;
  }
  row.push(cell);
  if (row.some((value) => value.length > 0)) rows.push(row);
  return rows;
}

function field(row: Record<string, unknown>, names: string[]): unknown {
  for (const name of names) {
    const match = Object.entries(row).find(([key]) => key.trim().toLowerCase() === name);
    if (match && match[1] != null && String(match[1]).trim() !== "") return match[1];
  }
  return undefined;
}

function mapAuctionRow(
  row: Record<string, unknown>,
  source: string
): AuctionLotRecord | null {
  if (
    "manufacturer_name" in normalizeKeys(row) ||
    "usd_price_decimal" in normalizeKeys(row) ||
    "item_title" in normalizeKeys(row)
  ) {
    return mapAltfnMotorcycleRow(
      {
        item_title: field(row, ["item_title", "title"]),
        manufacturer_name: field(row, ["manufacturer_name", "make", "manufacturer"]),
        brand_name: field(row, ["brand_name", "brand"]),
        model: field(row, ["model"]),
        production_year: field(row, ["production_year", "year", "model_year"]),
        vendor: field(row, ["vendor", "auction_house", "house"]),
        sale_price: field(row, ["sale_price", "hammer_price", "hammer"]),
        sale_currency: field(row, ["sale_currency", "currency"]),
        usd_price_decimal: field(row, [
          "usd_price_decimal",
          "price_usd",
          "usd_price",
          "realized_price_usd",
        ]),
        sale_date: field(row, ["sale_date", "date", "sold_at"]),
        sale_location: field(row, ["sale_location", "location", "city"]),
        sale_location_country: field(row, ["sale_location_country", "country"]),
        status: field(row, ["status"]),
        lot_url: field(row, ["lot_url", "url", "link"]),
      },
      source
    );
  }

  const make = text(field(row, ["make", "manufacturer", "brand"]));
  const model = text(field(row, ["model"]));
  const modelYear = parseModelYear(field(row, ["year", "model_year", "production_year"]));
  const currency = text(field(row, ["currency", "sale_currency"])).toUpperCase();
  const usd = parseUsd(
    field(row, ["price_usd", "usd_price", "usd_price_decimal", "realized_price_usd"])
  );
  const hammer = parseUsd(field(row, ["hammer_price", "sale_price", "hammer"]));
  const priceUsd = usd ?? (currency === "USD" ? hammer : null);
  const title =
    text(field(row, ["title", "item_title"])) ||
    [modelYear, make, model].filter(Boolean).join(" ");
  if (!make || !title) return null;
  const saleDate = parseSaleDate(field(row, ["sale_date", "date", "sold_at"]));
  const vendor = text(field(row, ["vendor", "auction_house", "house"])) || null;
  const lotUrl = safeHttpUrl(field(row, ["lot_url", "url", "link"]));

  return {
    source,
    sourceLotId: auctionSourceLotId(source, [
      lotUrl ?? "",
      title,
      saleDate ?? "",
      priceUsd != null ? String(priceUsd) : "",
      vendor ?? "",
    ]),
    title: title.slice(0, 300),
    make: make.slice(0, 80),
    model: model.slice(0, 120),
    modelYear,
    vendor,
    saleDate,
    status: parseAuctionStatus(field(row, ["status"]), priceUsd),
    priceUsd,
    hammerAmount: hammer,
    hammerCurrency: /^[A-Z]{3}$/.test(currency) ? currency : null,
    location: text(field(row, ["location", "city", "sale_location"])) || null,
    country: text(field(row, ["country", "sale_location_country"])) || null,
    lotUrl,
  };
}

function normalizeKeys(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) out[key.trim().toLowerCase()] = value;
  return out;
}

function text(value: unknown): string {
  if (typeof value !== "string" && typeof value !== "number") return "";
  return String(value).replace(/\s+/g, " ").trim();
}
