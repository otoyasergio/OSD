import { describe, it, expect, vi, afterEach } from "vitest";
import {
  calculateCheckDigit,
  hasValidCheckDigit,
  isNorthAmericanVin,
  normalizeVin,
  validateOptionalVin,
  validateVinFormat,
} from "@/lib/vin/validate";
import { decodeModelYearCode } from "@/lib/vin/year";
import { lookupWmi } from "@/lib/vin/wmi";
import { decodeVin, parseVinLocal, clearVinDecodeCache } from "@/lib/vin/decode";
import { motorcycleSchema } from "@/lib/validation/schemas";

/** Classic NA check-digit fixture (Wikipedia). */
const VALID_NA_VIN = "1M8GDM9AXKP042788";
/** Harley VIN with corrected check digit. */
const VALID_HD_VIN = "1HD1KEM16DB609584";
/** Japanese Honda — format valid; check digit not enforced (non-NA). */
const HONDA_JP_VIN = "JH2SC5900DM200001";

describe("normalizeVin", () => {
  it("trims, uppercases, and strips spaces/hyphens", () => {
    expect(normalizeVin(" 1hd-1kem16 db609584 ")).toBe("1HD1KEM16DB609584");
  });
});

describe("validateVinFormat", () => {
  it("accepts a known valid North American VIN", () => {
    expect(validateVinFormat(VALID_NA_VIN)).toEqual({
      ok: true,
      vin: VALID_NA_VIN,
    });
  });

  it("accepts a Harley VIN with valid check digit", () => {
    expect(validateVinFormat(VALID_HD_VIN).ok).toBe(true);
  });

  it("accepts a Japanese motorcycle VIN without requiring check digit", () => {
    expect(isNorthAmericanVin(HONDA_JP_VIN)).toBe(false);
    expect(validateVinFormat(HONDA_JP_VIN).ok).toBe(true);
  });

  it("rejects wrong length", () => {
    const result = validateVinFormat("1HD1KEM16");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/17 characters/i);
    }
  });

  it("rejects I, O, Q", () => {
    const result = validateVinFormat("1HD1KEM16DB60958O");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/I, O, or Q/i);
    }
  });

  it("rejects North American VINs with bad check digit", () => {
    const bad = "1HD1KEM10DB609584"; // expected check digit is 6
    expect(hasValidCheckDigit(bad)).toBe(false);
    const result = validateVinFormat(bad);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/check digit/i);
    }
  });

  it("calculates check digit X for the Wikipedia fixture", () => {
    expect(calculateCheckDigit(VALID_NA_VIN)).toBe("X");
  });

  it("treats seventeen 1s as check-digit valid", () => {
    expect(calculateCheckDigit("11111111111111111")).toBe("1");
    expect(hasValidCheckDigit("11111111111111111")).toBe(true);
  });
});

describe("validateOptionalVin", () => {
  it("allows blank", () => {
    expect(validateOptionalVin("")).toEqual({ ok: true, vin: "" });
    expect(validateOptionalVin(null)).toEqual({ ok: true, vin: "" });
    expect(validateOptionalVin(undefined)).toEqual({ ok: true, vin: "" });
    expect(validateOptionalVin("   ")).toEqual({ ok: true, vin: "" });
  });

  it("validates when present", () => {
    expect(validateOptionalVin("SHORT").ok).toBe(false);
    expect(validateOptionalVin(VALID_HD_VIN).ok).toBe(true);
  });
});

describe("decodeModelYearCode", () => {
  it("maps D to 2013 in the 2010 cycle", () => {
    expect(decodeModelYearCode("D", 2026)).toBe(2013);
  });

  it("maps 1 to 2001 when that is the newest plausible year", () => {
    expect(decodeModelYearCode("1", 2005)).toBe(2001);
  });
});

describe("lookupWmi", () => {
  it("recognizes Harley and Honda motorcycle WMIs", () => {
    expect(lookupWmi("1HD")?.manufacturer).toBe("Harley-Davidson");
    expect(lookupWmi("JH2")?.manufacturer).toBe("Honda");
    expect(lookupWmi("JH2")?.region).toBe("Asia");
  });
});

describe("parseVinLocal", () => {
  it("returns year and manufacturer hint", () => {
    const parsed = parseVinLocal(VALID_HD_VIN);
    expect(parsed?.wmi).toBe("1HD");
    expect(parsed?.manufacturerHint).toBe("Harley-Davidson");
    expect(parsed?.modelYear).toBe(2013);
  });
});

describe("decodeVin", () => {
  afterEach(() => {
    clearVinDecodeCache();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("returns validation errors without calling NHTSA", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const result = await decodeVin("TOO-SHORT");
    expect(result.valid).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("maps NHTSA flat results when fetch succeeds", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          Results: [
            {
              Make: "HARLEY-DAVIDSON",
              Model: "Electra Glide Ultra Limited",
              ModelYear: "2013",
              Manufacturer: "HARLEY-DAVIDSON MOTOR COMPANY",
              BodyClass: "Motorcycle - Touring/Sport Touring",
              VehicleType: "MOTORCYCLE",
              DisplacementL: "1.690000",
              ErrorText: "0 - VIN decoded clean",
            },
          ],
        }),
      })
    );

    const result = await decodeVin(VALID_HD_VIN);
    expect(result.valid).toBe(true);
    expect(result.source).toBe("nhtsa");
    expect(result.fullyDecoded).toBe(true);
    expect(result.fields.make).toBe("HARLEY-DAVIDSON");
    expect(result.fields.model).toBe("Electra Glide Ultra Limited");
    expect(result.fields.vehicleType).toBe("MOTORCYCLE");
  });

  it("falls back to local parse when NHTSA fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 503 })
    );

    const result = await decodeVin(VALID_HD_VIN);
    expect(result.valid).toBe(true);
    expect(result.source).toBe("local");
    expect(result.fullyDecoded).toBe(false);
    expect(result.message).toMatch(/Could not fully decode/i);
    expect(result.local?.manufacturerHint).toBe("Harley-Davidson");
  });
});

describe("motorcycleSchema VIN", () => {
  const base = {
    customer_id: "00000000-0000-4000-8000-000000000001",
    year: 2013,
    make: "Harley-Davidson",
    model: "Electra Glide",
  };

  it("allows missing VIN", () => {
    expect(motorcycleSchema.safeParse(base).success).toBe(true);
    expect(
      motorcycleSchema.safeParse({ ...base, vin: "" }).success
    ).toBe(true);
    expect(
      motorcycleSchema.safeParse({ ...base, vin: null }).success
    ).toBe(true);
  });

  it("normalizes and accepts a valid VIN", () => {
    const result = motorcycleSchema.safeParse({
      ...base,
      vin: ` ${VALID_HD_VIN.toLowerCase()} `,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.vin).toBe(VALID_HD_VIN);
    }
  });

  it("rejects an invalid VIN", () => {
    const result = motorcycleSchema.safeParse({
      ...base,
      vin: "1HD1KEM10DB609584",
    });
    expect(result.success).toBe(false);
  });
});
