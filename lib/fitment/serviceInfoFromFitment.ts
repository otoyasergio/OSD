import { rowCoversYear } from "@/lib/fitment/fitmentRange";

export type ServiceInfoFitmentFields = {
  oil_filter: string | null;
  oil_type: string | null;
  oil_capacity: string | null;
  air_filter: string | null;
  spark_plugs: string | null;
  front_brake_pads: string | null;
  rear_brake_pads: string | null;
  front_tire_size: string | null;
  rear_tire_size: string | null;
  chain: string | null;
  battery: string | null;
};

export type FitmentPayload = {
  make: string;
  model: string;
  year_start: number;
  year_end: number;
  spec_data: Record<string, string>;
  part_data: Record<string, string>;
};

const FIELD_SOURCES: Record<keyof ServiceInfoFitmentFields, string[]> = {
  oil_filter: ["oilFilterHF", "oilFilterKN"],
  oil_type: ["recommendedOil"],
  oil_capacity: [],
  air_filter: ["airFilterHFA", "airFilterKN"],
  spark_plugs: ["ngkPlug"],
  front_brake_pads: ["brakePadFront", "frontBrakePad"],
  rear_brake_pads: ["brakePadRear", "rearBrakePad"],
  front_tire_size: ["frontTireSize"],
  rear_tire_size: ["rearTireSize"],
  chain: ["chain"],
  battery: ["battery", "lithiumBattery"],
};

export function normalizeFitmentModelKey(value: string): string {
  return value.trim().toUpperCase().replace(/[\s\-_/]+/g, "");
}

function pickValues(
  sources: string[],
  spec: Record<string, string>,
  parts: Record<string, string>
): string | null {
  const values: string[] = [];
  for (const key of sources) {
    const raw = (parts[key] ?? spec[key] ?? "").trim();
    if (!raw) continue;
    if (!values.includes(raw)) values.push(raw);
  }
  return values.length > 0 ? values.join(" / ") : null;
}

export function mapFitmentToServiceInfo(
  vehicle: Pick<FitmentPayload, "spec_data" | "part_data">
): ServiceInfoFitmentFields {
  const spec = vehicle.spec_data ?? {};
  const parts = vehicle.part_data ?? {};
  const out = {} as ServiceInfoFitmentFields;
  for (const [field, sources] of Object.entries(FIELD_SOURCES) as Array<
    [keyof ServiceInfoFitmentFields, string[]]
  >) {
    out[field] = pickValues(sources, spec, parts);
  }
  return out;
}

export function isServiceInfoEmpty(
  info: Partial<ServiceInfoFitmentFields> | null | undefined
): boolean {
  if (!info) return true;
  return (Object.keys(FIELD_SOURCES) as Array<keyof ServiceInfoFitmentFields>).every(
    (field) => !info[field]?.trim()
  );
}

export function mergeServiceInfoFill(
  existing: Partial<ServiceInfoFitmentFields>,
  fill: ServiceInfoFitmentFields
): { next: ServiceInfoFitmentFields; filledCount: number } {
  const next = { ...fill };
  let filledCount = 0;
  for (const field of Object.keys(FIELD_SOURCES) as Array<
    keyof ServiceInfoFitmentFields
  >) {
    const current = existing[field]?.trim() || null;
    if (current) {
      next[field] = current;
      continue;
    }
    if (fill[field]) {
      next[field] = fill[field];
      filledCount += 1;
    } else {
      next[field] = null;
    }
  }
  return { next, filledCount };
}

export function scoreFitmentPayload(
  vehicle: Pick<FitmentPayload, "spec_data" | "part_data">
): number {
  return (
    Object.values(vehicle.spec_data ?? {}).filter((v) => String(v).trim()).length +
    Object.values(vehicle.part_data ?? {}).filter((v) => String(v).trim()).length
  );
}

/** Prefer normalized model match covering the year; richest payload wins. */
export function pickBestFitmentVehicle<T extends FitmentPayload>(
  rows: T[],
  year: number,
  make: string,
  model: string
): T | null {
  const makeKey = normalizeFitmentModelKey(make);
  const modelKey = normalizeFitmentModelKey(model);
  if (!makeKey || !modelKey) return null;

  const matches = rows.filter((row) => {
    if (normalizeFitmentModelKey(row.make) !== makeKey) return false;
    if (!rowCoversYear(row.year_start, row.year_end, year)) return false;
    return normalizeFitmentModelKey(row.model) === modelKey;
  });
  if (matches.length === 0) return null;

  return [...matches].sort(
    (a, b) => scoreFitmentPayload(b) - scoreFitmentPayload(a)
  )[0];
}
