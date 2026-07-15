import { describe, expect, it } from "vitest";
import {
  formatMileage,
  isMileageLowerThanPrevious,
  normalizeMileageUnit,
} from "@/lib/mileage/format";

describe("mileage formatting", () => {
  it("formats kilometre and mile readings", () => {
    expect(formatMileage(12000, "km")).toBe("12,000 km");
    expect(formatMileage("8500", "mi")).toBe("8,500 mi");
  });

  it("defaults unknown units to kilometres", () => {
    expect(normalizeMileageUnit("miles")).toBe("km");
    expect(formatMileage(100, undefined)).toBe("100 km");
  });

  it("returns a dash for missing or invalid readings", () => {
    expect(formatMileage(null, "km")).toBe("—");
    expect(formatMileage("invalid", "mi")).toBe("—");
  });

  it("detects a lower reading in the same unit", () => {
    expect(
      isMileageLowerThanPrevious({
        currentMileage: 11999,
        currentUnit: "km",
        previousMileage: 12000,
        previousUnit: "km",
      })
    ).toBe(true);
    expect(
      isMileageLowerThanPrevious({
        currentMileage: 12000,
        currentUnit: "km",
        previousMileage: 12000,
        previousUnit: "km",
      })
    ).toBe(false);
  });

  it("compares different units without warning on conversion rounding", () => {
    expect(
      isMileageLowerThanPrevious({
        currentMileage: 6214,
        currentUnit: "mi",
        previousMileage: 10000,
        previousUnit: "km",
      })
    ).toBe(false);
    expect(
      isMileageLowerThanPrevious({
        currentMileage: 6000,
        currentUnit: "mi",
        previousMileage: 10000,
        previousUnit: "km",
      })
    ).toBe(true);
  });
});
