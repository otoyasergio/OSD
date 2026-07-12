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
    note: parseOptionalNote(
      String(formData.get(`service_note_${serviceId}`) ?? "")
    ),
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
    estimated_labour_snapshot:
      line?.estimated_labour ?? args.catalogueLabour,
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
