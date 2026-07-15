import { describe, it, expect } from "vitest";
import {
  looksLikeShoppableSku,
  parsePartValue,
  skuLookupVariants,
} from "@/lib/fitment/partMatch";
import {
  makesForYear,
  modelsForYearMake,
  rowCoversYear,
} from "@/lib/fitment/fitmentRange";

describe("partMatch", () => {
  it("detects PC SKUs", () => {
    expect(looksLikeShoppableSku("0712-0094")).toBe(true);
    expect(looksLikeShoppableSku("HF204")).toBe(false);
  });

  it("parses combined part values", () => {
    expect(parsePartValue("HF204 (0712-0094)")).toEqual({
      code: "HF204",
      pc: "0712-0094",
    });
  });

  it("generates SKU lookup variants", () => {
    const variants = skuLookupVariants("0712-0094");
    expect(variants).toContain("0712-0094");
    expect(variants.length).toBeGreaterThan(1);
  });
});

describe("fitmentRange", () => {
  const rows = [
    { make: "KAWASAKI", model: "Ninja 400", year_start: 2018, year_end: 2024 },
    { make: "HONDA", model: "CBR600", year_start: 2015, year_end: 2017 },
  ];

  it("checks year coverage", () => {
    expect(rowCoversYear(2018, 2024, 2020)).toBe(true);
    expect(rowCoversYear(2018, 2024, 2010)).toBe(false);
  });

  it("lists makes for year", () => {
    expect(makesForYear(rows, 2020)).toEqual(["KAWASAKI"]);
  });

  it("lists models for year/make", () => {
    expect(modelsForYearMake(rows, 2020, "KAWASAKI")).toEqual(["Ninja 400"]);
  });
});
