/**
 * Shop labour rate used for hourly intake pricing.
 * Owners set this per location in Settings → Shop rate.
 */
export const DEFAULT_SHOP_HOURLY_RATE = 156;

export const SHOP_MINIMUM_HOURS = 0.25;

export const MAX_SHOP_HOURLY_RATE = 9_999;

/** Round a dollar amount to the cent so display and storage never carry float noise. */
export function roundToCents(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Storage / tires (and similar) are flat-rate — not billed at the hourly shop rate. */
export function isFlatRateService(service: {
  category?: string | null;
  name?: string | null;
}): boolean {
  const category = service.category?.trim().toLowerCase() ?? "";
  if (category === "storage") return true;
  const name = service.name?.trim().toLowerCase() ?? "";
  if (/\bstorage\b/.test(name)) return true;
  return (
    name === "front tire" ||
    name === "rear tire" ||
    name === "tire change" ||
    /\btire\b/.test(name)
  );
}

/** Parse an owner-entered shop rate. Returns null when the value is unusable. */
export function normalizeShopHourlyRate(value: unknown): number | null {
  if (value == null || value === "") return null;
  const numeric = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isFinite(numeric) || numeric <= 0 || numeric > MAX_SHOP_HOURLY_RATE) {
    return null;
  }
  return roundToCents(numeric);
}

/** Location setting when present, otherwise the current shop default. */
export function resolveShopHourlyRate(value: unknown): number {
  return normalizeShopHourlyRate(value) ?? DEFAULT_SHOP_HOURLY_RATE;
}

/** Labour charge for a given number of hours at the shop rate. */
export function labourPriceFromHours(
  hours: number | null | undefined,
  hourlyRate: number = DEFAULT_SHOP_HOURLY_RATE
): number | null {
  if (hours == null || !Number.isFinite(hours) || hours < 0) return null;
  const rate = resolveShopHourlyRate(hourlyRate);
  return roundToCents(hours * rate);
}

/** Format hours input string → suggested price string (empty if unknown). */
export function suggestedPriceFromLabourHours(
  labourHours: string,
  hourlyRate: number = DEFAULT_SHOP_HOURLY_RATE
): string {
  const trimmed = labourHours.trim();
  if (!trimmed) return "";
  const hours = Number(trimmed);
  const price = labourPriceFromHours(hours, hourlyRate);
  return price == null ? "" : String(price);
}

/**
 * Default intake line price: catalogue price if set, otherwise hours × shop rate.
 */
export function defaultServiceLinePrice(args: {
  cataloguePrice: number | null | undefined;
  catalogueLabour: number | null | undefined;
  labourHours?: string;
  hourlyRate?: number;
}): string {
  if (args.cataloguePrice != null && Number.isFinite(args.cataloguePrice)) {
    return String(args.cataloguePrice);
  }
  const rate = resolveShopHourlyRate(args.hourlyRate);
  const fromHours =
    args.labourHours != null ? suggestedPriceFromLabourHours(args.labourHours, rate) : "";
  if (fromHours) return fromHours;
  const fromCatalogue = labourPriceFromHours(args.catalogueLabour ?? null, rate);
  return fromCatalogue == null ? "" : String(fromCatalogue);
}
