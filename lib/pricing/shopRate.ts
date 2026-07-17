/**
 * Toronto Moto shop labour rate from the drop-off / service agreement.
 * Shop minimum is 0.25 hours of this rate.
 */
export const SHOP_HOURLY_RATE = 145;

export const SHOP_MINIMUM_HOURS = 0.25;

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

/** Labour charge for a given number of hours at the shop rate. */
export function labourPriceFromHours(hours: number | null | undefined): number | null {
  if (hours == null || !Number.isFinite(hours) || hours < 0) return null;
  // Avoid floating junk like 217.5000000001 for display/storage.
  return Math.round(hours * SHOP_HOURLY_RATE * 100) / 100;
}

/** Format hours input string → suggested price string (empty if unknown). */
export function suggestedPriceFromLabourHours(labourHours: string): string {
  const trimmed = labourHours.trim();
  if (!trimmed) return "";
  const hours = Number(trimmed);
  const price = labourPriceFromHours(hours);
  return price == null ? "" : String(price);
}

/**
 * Default intake line price: catalogue price if set, otherwise hours × shop rate.
 */
export function defaultServiceLinePrice(args: {
  cataloguePrice: number | null | undefined;
  catalogueLabour: number | null | undefined;
  labourHours?: string;
}): string {
  if (args.cataloguePrice != null && Number.isFinite(args.cataloguePrice)) {
    return String(args.cataloguePrice);
  }
  const fromHours =
    args.labourHours != null ? suggestedPriceFromLabourHours(args.labourHours) : "";
  if (fromHours) return fromHours;
  const fromCatalogue = labourPriceFromHours(args.catalogueLabour ?? null);
  return fromCatalogue == null ? "" : String(fromCatalogue);
}
