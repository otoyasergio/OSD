import {
  DEFAULT_SHOP_HOURLY_RATE,
  suggestedPriceFromLabourHours,
} from "@/lib/pricing/shopRate";

export type ServiceLineInput = {
  service_id: string;
  note: string | null;
  estimated_labour: number | null;
  standard_price: number | null;
};

export type ServiceLineDraft = {
  note: string;
  labourHours: string;
  price: string;
};

/** Fitment stored on the bike. Blank fields stay off the invoice names and notes. */
export type BikePackageFitment = {
  oil_filter?: string | null;
  oil_type?: string | null;
  spark_plugs?: string | null;
  air_filter?: string | null;
};

export type IncludedPartLine = {
  part_name: string;
  unit_price: 0;
  quantity: 1;
};

function isDiagnosticService(name: string): boolean {
  return /^(diagnostic|diagnostics)$/i.test(name.trim());
}

export function isOilChangeService(name: string): boolean {
  return name.trim().toLowerCase() === "oil change";
}

export function isSeasonalTuneUp(name: string): boolean {
  const normalized = name.trim().toLowerCase();
  return normalized === "fall tune up" || normalized === "spring/summer tune up";
}

function fitmentDetail(label: string, value: string | null | undefined): string {
  const detail = value?.trim() ?? "";
  return detail ? `${label} ${detail}` : label;
}

/** Staff can edit this note. The tune-up price stays the catalogue amount. */
export function tuneUpIncludedNote(fitment?: BikePackageFitment | null): string {
  const listed = [
    fitmentDetail("oil", fitment?.oil_type),
    fitmentDetail("filter", fitment?.oil_filter),
    fitmentDetail("spark plug", fitment?.spark_plugs),
    fitmentDetail("air filter", fitment?.air_filter),
  ];
  return `Includes ${listed.slice(0, -1).join(", ")}, and ${listed[listed.length - 1]}.`;
}

/**
 * Oil change is one $165 job. Filter and oil are $0 lines on that job.
 * Names use the bike's fitment when it is filled in.
 */
export function oilChangeIncludedParts(
  fitment?: BikePackageFitment | null
): IncludedPartLine[] {
  const filter = fitment?.oil_filter?.trim() ?? "";
  const oil = fitment?.oil_type?.trim() ?? "";
  return [
    {
      part_name: filter ? `Oil filter ${filter}` : "Oil filter",
      unit_price: 0,
      quantity: 1,
    },
    {
      part_name: oil ? `Oil ${oil}` : "Oil",
      unit_price: 0,
      quantity: 1,
    },
  ];
}

/**
 * Create the editable intake line for a selected service.
 * A diagnostic starts at one labour hour. A catalogue price wins.
 * Catalogue labour with no fixed price fills hours × the shop rate.
 * Prices stay pre-tax.
 */
export function createIntakeServiceLineDraft(args: {
  name: string;
  estimatedLabour: number | null;
  standardPrice: number | null;
  fitment?: BikePackageFitment | null;
  shopHourlyRate?: number;
}): ServiceLineDraft {
  const diagnostic = isDiagnosticService(args.name);
  const hasFixedPrice = args.standardPrice != null && Number.isFinite(args.standardPrice);
  const catalogueLabour =
    args.estimatedLabour != null &&
    Number.isFinite(args.estimatedLabour) &&
    args.estimatedLabour >= 0
      ? args.estimatedLabour
      : null;
  const labourHours = diagnostic
    ? String(catalogueLabour ?? 1)
    : !hasFixedPrice && catalogueLabour != null
      ? String(catalogueLabour)
      : "";
  const shopHourlyRate = args.shopHourlyRate ?? DEFAULT_SHOP_HOURLY_RATE;

  return {
    note: isSeasonalTuneUp(args.name) ? tuneUpIncludedNote(args.fitment) : "",
    labourHours,
    price: hasFixedPrice
      ? String(args.standardPrice)
      : labourHours
        ? suggestedPriceFromLabourHours(labourHours, shopHourlyRate)
        : "",
  };
}

/** Total the selected, editable pre-tax service prices without floating-point drift. */
export function serviceLineSubtotalDollars(
  lines: ReadonlyArray<ServiceLineDraft | undefined>
): number {
  const cents = lines.reduce((sum, line) => {
    const price = Number(line?.price.trim() ?? "");
    if (!Number.isFinite(price) || price < 0) return sum;
    return sum + Math.round(price * 100);
  }, 0);
  return cents / 100;
}

/** A selected intake service is priced when it has a finite, non-negative amount. */
export function hasValidServiceLinePrice(line: ServiceLineDraft | undefined): boolean {
  const raw = line?.price.trim() ?? "";
  if (!raw) return false;
  const price = Number(raw);
  return Number.isFinite(price) && price >= 0;
}

function parseOptionalNonNegative(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value < 0) return null;
  return value;
}

function parseOptionalNote(raw: string): string | null {
  const trimmed = raw.trim();
  return trimmed ? trimmed : null;
}

/** Build job line overrides from intake FormData for selected service ids. */
export function readServiceLinesFromFormData(
  formData: FormData,
  serviceIds: string[]
): ServiceLineInput[] {
  return serviceIds.map((serviceId) => ({
    service_id: serviceId,
    note: parseOptionalNote(String(formData.get(`service_note_${serviceId}`) ?? "")),
    estimated_labour: parseOptionalNonNegative(
      String(formData.get(`service_labour_${serviceId}`) ?? "")
    ),
    standard_price: parseOptionalNonNegative(
      String(formData.get(`service_price_${serviceId}`) ?? "")
    ),
  }));
}

export function resolveJobSnapshots(args: {
  catalogueLabour: number | null;
  cataloguePrice: number | null;
  line: ServiceLineInput | undefined;
}): {
  notes: string | null;
  estimated_labour_snapshot: number | null;
  standard_price_snapshot: number | null;
} {
  const line = args.line;
  return {
    notes: line?.note ?? null,
    estimated_labour_snapshot: line?.estimated_labour ?? args.catalogueLabour,
    standard_price_snapshot: line?.standard_price ?? args.cataloguePrice,
  };
}

export function formatServiceLineSummary(args: {
  name: string;
  labourHours: string;
  price: string;
  note: string;
}): string {
  const bits: string[] = [args.name];
  const labour = args.labourHours.trim();
  const price = args.price.trim();
  if (labour) bits.push(`${labour} h`);
  if (price) bits.push(`$${price}`);
  if (args.note.trim()) bits.push(args.note.trim());
  return bits.join(" · ");
}
