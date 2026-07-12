/** ISO 3779 / North American VIN format + check digit (49 CFR 565). */

export const VIN_LENGTH = 17;

/** Digits and letters excluding I, O, Q (confusion with 1 / 0). */
export const VIN_CHARSET = /^[A-HJ-NPR-Z0-9]+$/;

const TRANSLITERATION: Record<string, number> = {
  "0": 0,
  "1": 1,
  "2": 2,
  "3": 3,
  "4": 4,
  "5": 5,
  "6": 6,
  "7": 7,
  "8": 8,
  "9": 9,
  A: 1,
  B: 2,
  C: 3,
  D: 4,
  E: 5,
  F: 6,
  G: 7,
  H: 8,
  J: 1,
  K: 2,
  L: 3,
  M: 4,
  N: 5,
  P: 7,
  R: 9,
  S: 2,
  T: 3,
  U: 4,
  V: 5,
  W: 6,
  X: 7,
  Y: 8,
  Z: 9,
};

/** Position weights; index 8 (check digit) is 0. */
const WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2] as const;

export type VinValidationOk = { ok: true; vin: string };
export type VinValidationFail = { ok: false; error: string; vin: string };
export type VinValidationResult = VinValidationOk | VinValidationFail;

export function normalizeVin(raw: string): string {
  return raw.trim().toUpperCase().replace(/[\s-]/g, "");
}

/** North American VINs use WMI region codes starting with 1–5. */
export function isNorthAmericanVin(vin: string): boolean {
  const first = vin.charAt(0);
  return first >= "1" && first <= "5";
}

export function calculateCheckDigit(vin: string): string {
  if (vin.length !== VIN_LENGTH) {
    throw new Error("VIN must be 17 characters to calculate check digit");
  }
  let sum = 0;
  for (let i = 0; i < VIN_LENGTH; i += 1) {
    const value = TRANSLITERATION[vin[i]];
    if (value === undefined) {
      throw new Error(`Invalid VIN character at position ${i + 1}`);
    }
    sum += value * WEIGHTS[i];
  }
  const remainder = sum % 11;
  return remainder === 10 ? "X" : String(remainder);
}

export function hasValidCheckDigit(vin: string): boolean {
  try {
    return vin[8] === calculateCheckDigit(vin);
  } catch {
    return false;
  }
}

/**
 * Validate VIN format. Blank input is invalid here — use
 * `validateOptionalVin` when VIN is optional.
 */
export function validateVinFormat(raw: string): VinValidationResult {
  const vin = normalizeVin(raw);

  if (!vin) {
    return { ok: false, error: "Enter a VIN.", vin: "" };
  }

  if (vin.length !== VIN_LENGTH) {
    return {
      ok: false,
      error: `VIN must be exactly ${VIN_LENGTH} characters (got ${vin.length}).`,
      vin,
    };
  }

  if (!VIN_CHARSET.test(vin)) {
    return {
      ok: false,
      error: "VIN may only use letters A–H, J–N, P, R–Z and digits 0–9 (no I, O, or Q).",
      vin,
    };
  }

  if (isNorthAmericanVin(vin) && !hasValidCheckDigit(vin)) {
    return {
      ok: false,
      error:
        "VIN check digit is invalid. Double-check the number — North American VINs include a check digit in position 9.",
      vin,
    };
  }

  return { ok: true, vin };
}

/** Empty / whitespace is allowed (VIN optional). Non-empty must be valid. */
export function validateOptionalVin(
  raw: string | null | undefined
): VinValidationResult {
  if (raw == null || !String(raw).trim()) {
    return { ok: true, vin: "" };
  }
  return validateVinFormat(raw);
}
