import { describe, it, expect } from "vitest";
import { extractVinFromScanText } from "@/lib/vin/extractFromScan";

/** Classic NA check-digit fixture (Wikipedia). */
const VALID_NA_VIN = "1M8GDM9AXKP042788";
/** Harley VIN with corrected check digit. */
const VALID_HD_VIN = "1HD1KEM16DB609584";
/** Japanese Honda — format valid; check digit not enforced (non-NA). */
const HONDA_JP_VIN = "JH2SC5900DM200001";

describe("extractVinFromScanText", () => {
  it("accepts a clean barcode payload that is exactly the VIN", () => {
    const result = extractVinFromScanText(VALID_HD_VIN);
    expect(result).toMatchObject({ ok: true, vin: VALID_HD_VIN, ambiguous: false });
  });

  it("strips spaces, hyphens, and surrounding label text", () => {
    const result = extractVinFromScanText(`VIN: ${VALID_NA_VIN} USA`);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.vin).toBe(VALID_NA_VIN);
    }
  });

  it("finds a VIN embedded in longer barcode text", () => {
    const result = extractVinFromScanText(`MFG${VALID_HD_VIN}END`);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.vin).toBe(VALID_HD_VIN);
    }
  });

  it("accepts Japanese motorcycle VINs without NA check digit", () => {
    const result = extractVinFromScanText(HONDA_JP_VIN);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.vin).toBe(HONDA_JP_VIN);
    }
  });

  it("corrects OCR I/O noise into a valid VIN", () => {
    // Position with letter O that should be 0 (Harley serial uses digits).
    // VALID_HD_VIN = 1HD1KEM16DB609584 — swap a 0 for O and a 1 for I.
    const noisy = "IHD1KEM16DB6O9584"; // I→1, O→0 → 1HD1KEM16DB609584
    const result = extractVinFromScanText(noisy);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.vin).toBe(VALID_HD_VIN);
    }
  });

  it("rejects North American VINs with bad check digit", () => {
    const bad = "1HD1KEM10DB609584"; // expected check digit is 6
    const result = extractVinFromScanText(bad);
    expect(result.ok).toBe(false);
  });

  it("returns failure for empty / non-VIN text", () => {
    const result = extractVinFromScanText("hello world");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/valid 17-character VIN|No VIN/i);
    }
  });

  it("prefers a check-digit-valid NA VIN over a weaker embedded candidate", () => {
    const result = extractVinFromScanText(`${VALID_HD_VIN}XX${HONDA_JP_VIN}`);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.vin).toBe(VALID_HD_VIN);
      expect(result.ambiguous).toBe(false);
    }
  });

  it("flags ambiguous when two equally strong VINs appear", () => {
    const result = extractVinFromScanText(`${VALID_HD_VIN}XX${VALID_NA_VIN}`);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.ambiguous).toBe(true);
      expect(result.candidates).toEqual(
        expect.arrayContaining([VALID_HD_VIN, VALID_NA_VIN])
      );
    }
  });
});
