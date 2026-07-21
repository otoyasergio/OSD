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

const SERVICE_INFO_FIELDS = Object.keys(FIELD_SOURCES) as Array<
  keyof ServiceInfoFitmentFields
>;

/** Strip common family prefixes so "YZF-R3" aligns with staff model "R3". */
const FITMENT_MODEL_PREFIX_SOURCE =
  "YZFR|YZF|YZ|MT|FZ|XSR|XVS|XV|WR|XT|TW|SR|TMAX|NMAX|CBR|CB|CRF|CR|XR|DRZ|DR|GSXRS|GSXR|GSX|SV|DL|RC";
const FITMENT_MODEL_PREFIX = new RegExp(`^(?:${FITMENT_MODEL_PREFIX_SOURCE})`);

export function normalizeFitmentModelKey(value: string): string {
  return value
    .trim()
    .toUpperCase()
    .replace(/[\s\-_/]+/g, "");
}

function stripFitmentModelPrefix(key: string): string {
  return key.replace(FITMENT_MODEL_PREFIX, "");
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function matchesPrefixedModel(catalogue: string, modelKey: string): boolean {
  if (!modelKey) return false;
  // "YZF-R3" / "YZFR3 R-3" → YZFR3 / YZFR3R3 against staff model "R3"
  const pattern = new RegExp(
    `^(?:${FITMENT_MODEL_PREFIX_SOURCE})*${escapeRegex(modelKey)}(?:${escapeRegex(modelKey)})?$`
  );
  return pattern.test(catalogue);
}

function affinityAgainstNormalized(bike: string, catalogue: string): number {
  if (!bike || !catalogue) return 0;
  if (bike === catalogue) return 100;

  const bikeCore = stripFitmentModelPrefix(bike) || bike;
  const catalogueCore = stripFitmentModelPrefix(catalogue) || catalogue;
  if (bikeCore && catalogueCore && bikeCore === catalogueCore) return 90;
  if (bike === catalogueCore || bikeCore === catalogue) return 90;

  if (
    matchesPrefixedModel(catalogue, bike) ||
    matchesPrefixedModel(catalogue, bikeCore)
  ) {
    return 85;
  }

  // Longer model keys can use safer substring checks.
  if (bike.length >= 4 && catalogue.endsWith(bike)) return 80;
  if (catalogue.length >= 4 && bike.endsWith(catalogue)) return 70;
  if (bike.length >= 4 && catalogue.includes(bike)) return 60;
  if (catalogue.length >= 4 && bike.includes(catalogue)) return 50;

  return 0;
}

/**
 * How closely a catalogue model matches the bike model.
 * 0 = unrelated (must not use). Higher is a tighter match.
 */
/** "V-Strom 1000" ↔ "DL1000 V-Strom": every meaningful token appears in catalogue key. */
function tokenCoverageAffinity(bikeModel: string, fitmentModel: string): number {
  const catalogue = normalizeFitmentModelKey(fitmentModel);
  const words = bikeModel
    .replace(/\([^)]*\)/g, " ")
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 3 && !["ABS", "ABSSE", "THE", "AND"].includes(w));
  if (words.length < 2) return 0;
  if (words.every((word) => catalogue.includes(word))) return 55;
  return 0;
}

export function fitmentModelAffinity(bikeModel: string, fitmentModel: string): number {
  const catalogue = normalizeFitmentModelKey(fitmentModel);
  const parenContents = [...bikeModel.matchAll(/\(([^)]+)\)/g)].map((m) => m[1].trim());
  const variants = [
    bikeModel,
    // "NPS50 (Ruckus)" / "VT750 (Shadow Spirit 750)"
    bikeModel.replace(/\s*\([^)]*\)\s*/g, " ").trim(),
    // Nickname inside parens ("Ruckus")
    ...parenContents,
    // "Ninja 500 SE" → drop trim-level suffixes
    bikeModel.replace(/\b(SE|ABS|ABSSE)\b/gi, " ").trim(),
  ].filter(Boolean);

  let best = 0;
  for (const variant of variants) {
    best = Math.max(
      best,
      affinityAgainstNormalized(normalizeFitmentModelKey(variant), catalogue),
      tokenCoverageAffinity(variant, fitmentModel)
    );
  }
  return best;
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

/** Merge several mapped payloads field-by-field (unique values joined). */
export function mergeMappedServiceInfo(
  maps: ServiceInfoFitmentFields[]
): ServiceInfoFitmentFields {
  const out = {} as ServiceInfoFitmentFields;
  for (const field of SERVICE_INFO_FIELDS) {
    const values: string[] = [];
    for (const map of maps) {
      const raw = map[field]?.trim();
      if (!raw) continue;
      for (const part of raw.split(" / ")) {
        const value = part.trim();
        if (value && !values.includes(value)) values.push(value);
      }
    }
    out[field] = values.length > 0 ? values.join(" / ") : null;
  }
  return out;
}

export function isServiceInfoEmpty(
  info: Partial<ServiceInfoFitmentFields> | null | undefined
): boolean {
  if (!info) return true;
  return SERVICE_INFO_FIELDS.every((field) => !info[field]?.trim());
}

function tokenizeFieldValue(value: string): string[] {
  return value
    .split(" / ")
    .map((part) => part.trim())
    .filter(Boolean);
}

/** True when current looks like a prior fitment fill (not a custom staff value). */
export function isFitmentOwnedValue(current: string, fill: string): boolean {
  const currentParts = tokenizeFieldValue(current);
  const fillParts = tokenizeFieldValue(fill);
  if (currentParts.length === 0 || fillParts.length === 0) return false;
  return currentParts.every((part) => fillParts.includes(part));
}

export function mergeServiceInfoFill(
  existing: Partial<ServiceInfoFitmentFields>,
  fill: ServiceInfoFitmentFields,
  options: { refreshFitmentValues?: boolean } = {}
): { next: ServiceInfoFitmentFields; filledCount: number } {
  const refresh = options.refreshFitmentValues === true;
  const next = { ...fill };
  let filledCount = 0;
  for (const field of SERVICE_INFO_FIELDS) {
    const current = existing[field]?.trim() || null;
    const incoming = fill[field]?.trim() || null;
    if (!current) {
      next[field] = incoming;
      if (incoming) filledCount += 1;
      continue;
    }
    if (
      refresh &&
      incoming &&
      isFitmentOwnedValue(current, incoming) &&
      current !== incoming
    ) {
      next[field] = incoming;
      filledCount += 1;
      continue;
    }
    next[field] = current;
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

export function scoreServiceInfoPayload(
  vehicle: Pick<FitmentPayload, "spec_data" | "part_data">
): number {
  return Object.values(mapFitmentToServiceInfo(vehicle)).filter((v) => v?.trim()).length;
}

/** Related catalogue rows for this YMM (exact + alias), year-covered. */
export function listFitmentCandidatesForServiceInfo<T extends FitmentPayload>(
  rows: T[],
  year: number,
  make: string,
  model: string
): T[] {
  const makeKey = normalizeFitmentModelKey(make);
  if (!makeKey || !normalizeFitmentModelKey(model)) return [];

  return rows
    .filter((row) => {
      if (normalizeFitmentModelKey(row.make) !== makeKey) return false;
      if (!rowCoversYear(row.year_start, row.year_end, year)) return false;
      return fitmentModelAffinity(model, row.model) > 0;
    })
    .sort((a, b) => {
      const affinityDelta =
        fitmentModelAffinity(model, b.model) - fitmentModelAffinity(model, a.model);
      if (affinityDelta !== 0) return affinityDelta;
      return scoreServiceInfoPayload(b) - scoreServiceInfoPayload(a);
    });
}

/** Build merged service-info fill from all related fitment rows. */
export function buildServiceInfoFromFitmentRows(
  rows: FitmentPayload[],
  year: number,
  make: string,
  model: string
): ServiceInfoFitmentFields | null {
  const candidates = listFitmentCandidatesForServiceInfo(rows, year, make, model);
  if (candidates.length === 0) return null;
  return mergeMappedServiceInfo(candidates.map((row) => mapFitmentToServiceInfo(row)));
}

/** Prefer normalized model match covering the year; richest payload wins. */
export function pickBestFitmentVehicle<T extends FitmentPayload>(
  rows: T[],
  year: number,
  make: string,
  model: string
): T | null {
  const candidates = listFitmentCandidatesForServiceInfo(rows, year, make, model);
  if (candidates.length === 0) return null;

  // Prefer a row that actually has service-info data; else richest overall.
  const withServiceInfo = candidates.filter((row) => scoreServiceInfoPayload(row) > 0);
  const pool = withServiceInfo.length > 0 ? withServiceInfo : candidates;
  return [...pool].sort((a, b) => {
    const serviceDelta = scoreServiceInfoPayload(b) - scoreServiceInfoPayload(a);
    if (serviceDelta !== 0) return serviceDelta;
    const affinityDelta =
      fitmentModelAffinity(model, b.model) - fitmentModelAffinity(model, a.model);
    if (affinityDelta !== 0) return affinityDelta;
    return scoreFitmentPayload(b) - scoreFitmentPayload(a);
  })[0];
}
