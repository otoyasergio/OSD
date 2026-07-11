import { normalizeVin, validateVinFormat } from "@/lib/vin/validate";
import { decodeModelYearCode } from "@/lib/vin/year";
import { lookupWmi } from "@/lib/vin/wmi";

export type VinLocalParse = {
  vin: string;
  wmi: string;
  modelYear: number | null;
  region: string | null;
  manufacturerHint: string | null;
  plantCode: string | null;
};

export type VinDecodeFields = {
  make: string | null;
  model: string | null;
  modelYear: string | null;
  manufacturer: string | null;
  bodyClass: string | null;
  vehicleType: string | null;
  displacementL: string | null;
  displacementCC: string | null;
  engineHP: string | null;
  motorcycleChassisType: string | null;
  motorcycleSuspensionType: string | null;
  plantCity: string | null;
  plantCountry: string | null;
  errorText: string | null;
};

export type VinDecodeResult = {
  vin: string;
  valid: boolean;
  validationError: string | null;
  source: "nhtsa" | "local";
  fullyDecoded: boolean;
  message: string | null;
  local: VinLocalParse | null;
  fields: VinDecodeFields;
};

type NhtsaFlatResult = Record<string, string | undefined>;

const NHTSA_URL =
  "https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues";

const CACHE_TTL_MS = 10 * 60 * 1000;
const cache = new Map<string, { expires: number; value: VinDecodeResult }>();

/** Test helper — clears the in-memory NHTSA response cache. */
export function clearVinDecodeCache(): void {
  cache.clear();
}

function emptyFields(): VinDecodeFields {
  return {
    make: null,
    model: null,
    modelYear: null,
    manufacturer: null,
    bodyClass: null,
    vehicleType: null,
    displacementL: null,
    displacementCC: null,
    engineHP: null,
    motorcycleChassisType: null,
    motorcycleSuspensionType: null,
    plantCity: null,
    plantCountry: null,
    errorText: null,
  };
}

function pick(result: NhtsaFlatResult, key: string): string | null {
  const value = result[key]?.trim();
  if (!value || value === "Not Applicable") return null;
  return value;
}

export function parseVinLocal(raw: string): VinLocalParse | null {
  const validation = validateVinFormat(raw);
  if (!validation.ok) return null;
  const { vin } = validation;
  const wmi = vin.slice(0, 3);
  const hint = lookupWmi(wmi);
  return {
    vin,
    wmi,
    modelYear: decodeModelYearCode(vin[9]),
    region: hint?.region ?? null,
    manufacturerHint: hint?.manufacturer ?? null,
    plantCode: vin[10] ?? null,
  };
}

function localFallback(
  vin: string,
  validationError: string | null,
  message: string
): VinDecodeResult {
  const local = parseVinLocal(vin);
  const fields = emptyFields();
  if (local?.modelYear != null) {
    fields.modelYear = String(local.modelYear);
  }
  if (local?.manufacturerHint) {
    fields.make = local.manufacturerHint;
    fields.manufacturer = local.manufacturerHint;
  }
  return {
    vin,
    valid: validationError == null,
    validationError,
    source: "local",
    fullyDecoded: false,
    message,
    local,
    fields,
  };
}

function fromNhtsa(vin: string, result: NhtsaFlatResult): VinDecodeResult {
  const local = parseVinLocal(vin);
  const fields: VinDecodeFields = {
    make: pick(result, "Make"),
    model: pick(result, "Model"),
    modelYear: pick(result, "ModelYear"),
    manufacturer: pick(result, "Manufacturer"),
    bodyClass: pick(result, "BodyClass"),
    vehicleType: pick(result, "VehicleType"),
    displacementL: pick(result, "DisplacementL"),
    displacementCC: pick(result, "DisplacementCC"),
    engineHP: pick(result, "EngineHP"),
    motorcycleChassisType: pick(result, "MotorcycleChassisType"),
    motorcycleSuspensionType: pick(result, "MotorcycleSuspensionType"),
    plantCity: pick(result, "PlantCity"),
    plantCountry: pick(result, "PlantCountry"),
    errorText: pick(result, "ErrorText"),
  };

  const hasCore = Boolean(fields.make || fields.model || fields.modelYear);
  return {
    vin,
    valid: true,
    validationError: null,
    source: "nhtsa",
    fullyDecoded: hasCore,
    message: hasCore
      ? null
      : "Could not fully decode this VIN. Local hints are shown below.",
    local,
    fields,
  };
}

export async function decodeVin(raw: string): Promise<VinDecodeResult> {
  const validation = validateVinFormat(raw);
  if (!validation.ok) {
    return {
      vin: validation.vin,
      valid: false,
      validationError: validation.error,
      source: "local",
      fullyDecoded: false,
      message: validation.error,
      local: null,
      fields: emptyFields(),
    };
  }

  const { vin } = validation;
  const cached = cache.get(vin);
  if (cached && cached.expires > Date.now()) {
    return cached.value;
  }

  try {
    const response = await fetch(`${NHTSA_URL}/${encodeURIComponent(vin)}?format=json`, {
      headers: { Accept: "application/json" },
      next: { revalidate: 600 },
    });

    if (!response.ok) {
      const fallback = localFallback(
        vin,
        null,
        "Could not fully decode — NHTSA lookup failed. Showing local VIN hints."
      );
      return fallback;
    }

    const payload = (await response.json()) as {
      Results?: NhtsaFlatResult[];
    };
    const result = payload.Results?.[0];
    if (!result) {
      return localFallback(
        vin,
        null,
        "Could not fully decode — no NHTSA results. Showing local VIN hints."
      );
    }

    const decoded = fromNhtsa(vin, result);
    cache.set(vin, { expires: Date.now() + CACHE_TTL_MS, value: decoded });
    return decoded;
  } catch {
    return localFallback(
      vin,
      null,
      "Could not fully decode — network error. Showing local VIN hints."
    );
  }
}

export function summarizeDecode(result: VinDecodeResult): string {
  const { fields, local } = result;
  const year = fields.modelYear ?? (local?.modelYear != null ? String(local.modelYear) : null);
  const make = fields.make ?? local?.manufacturerHint;
  const model = fields.model;
  const parts = [year, make, model].filter(Boolean);
  if (parts.length > 0) return parts.join(" ");
  if (fields.vehicleType) return fields.vehicleType;
  if (local?.region) return `${local.region} vehicle (${local.wmi})`;
  return "Vehicle";
}

export { normalizeVin };
