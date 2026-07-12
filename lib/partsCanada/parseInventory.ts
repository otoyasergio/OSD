export type PartsCanadaCatalogRow = {
  part_number: string;
  old_part_number: string | null;
  manufacturer_part_number: string | null;
  upc_code: string | null;
  brand: string | null;
  description_en: string | null;
  description_fr: string | null;
  msrp: number | null;
  dealer_price: number | null;
  dealer_net_price: number | null;
  qty_cal: number | null;
  qty_lon: number | null;
  commodity_code: string | null;
};

function normalizeHeader(header: string): string {
  return header
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === "," && !inQuotes) {
      cells.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  cells.push(current);
  return cells;
}

function parseNumber(raw: string | undefined): number | null {
  if (!raw) return null;
  const cleaned = raw.trim().replace(/[$,]/g, "");
  if (!cleaned) return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

function parseIntOrNull(raw: string | undefined): number | null {
  const value = parseNumber(raw);
  if (value === null) return null;
  return Math.round(value);
}

function pick(
  row: Record<string, string>,
  ...keys: string[]
): string | undefined {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value.trim() !== "") return value;
  }
  return undefined;
}

/**
 * Parse Parts Canada inventory CSV text into catalog rows.
 * Header names vary slightly; we normalize and accept common aliases.
 */
export function parseInventoryCsv(csvText: string): PartsCanadaCatalogRow[] {
  const lines = csvText
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);

  if (lines.length < 2) return [];

  const headers = parseCsvLine(lines[0]!).map(normalizeHeader);
  const rows: PartsCanadaCatalogRow[] = [];

  for (let i = 1; i < lines.length; i += 1) {
    const cells = parseCsvLine(lines[i]!);
    const mapped: Record<string, string> = {};
    for (let c = 0; c < headers.length; c += 1) {
      mapped[headers[c]!] = cells[c] ?? "";
    }

    const partNumber = pick(
      mapped,
      "part_number",
      "part_no",
      "partnumber"
    )?.trim();
    if (!partNumber) continue;

    rows.push({
      part_number: partNumber,
      old_part_number: pick(mapped, "old_part_number")?.trim() || null,
      manufacturer_part_number:
        pick(mapped, "manufacturer_part_number", "mfr_part_number")?.trim() ||
        null,
      upc_code: pick(mapped, "upc_code", "upc")?.trim() || null,
      brand: pick(mapped, "brand")?.trim() || null,
      description_en:
        pick(mapped, "description_en", "description", "desc_en")?.trim() ||
        null,
      description_fr: pick(mapped, "description_fr", "desc_fr")?.trim() || null,
      msrp: parseNumber(pick(mapped, "msrp_latest", "msrp")),
      dealer_price: parseNumber(pick(mapped, "dealer_price")),
      dealer_net_price: parseNumber(
        pick(mapped, "dealer_net_price", "net_price")
      ),
      qty_cal: parseIntOrNull(
        pick(mapped, "cal_qty_available", "qty_cal", "cal_qty")
      ),
      qty_lon: parseIntOrNull(
        pick(mapped, "lon_qty_available", "qty_lon", "lon_qty")
      ),
      commodity_code: pick(mapped, "commodity_code")?.trim() || null,
    });
  }

  return rows;
}

export function supplierStockTotal(
  qtyCal: number | null | undefined,
  qtyLon: number | null | undefined
): number | null {
  if (qtyCal == null && qtyLon == null) return null;
  return (qtyCal ?? 0) + (qtyLon ?? 0);
}
