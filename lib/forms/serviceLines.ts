import { suggestedPriceFromLabourHours } from "@/lib/pricing/shopRate";

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

function isDiagnosticService(name: string): boolean {
  return /^(diagnostic|diagnostics)$/i.test(name.trim());
}

/**
 * Create the editable intake line for a selected service.
 * Diagnostic starts at one labour hour; all prices remain pre-tax.
 */
export function createIntakeServiceLineDraft(args: {
  name: string;
  estimatedLabour: number | null;
  standardPrice: number | null;
}): ServiceLineDraft {
  const diagnostic = isDiagnosticService(args.name);
  const estimatedLabour =
    args.estimatedLabour != null &&
    Number.isFinite(args.estimatedLabour) &&
    args.estimatedLabour >= 0
      ? args.estimatedLabour
      : 1;
  const labourHours = diagnostic ? String(estimatedLabour) : "";

  return {
    note: "",
    labourHours,
    price:
      args.standardPrice != null && Number.isFinite(args.standardPrice)
        ? String(args.standardPrice)
        : diagnostic
          ? suggestedPriceFromLabourHours(labourHours)
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
