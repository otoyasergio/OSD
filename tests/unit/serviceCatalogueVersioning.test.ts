import { describe, expect, it } from "vitest";
import {
  buildServiceVersionSnapshot,
  nextServiceVersionNo,
  shouldWriteServiceVersion,
  type ServiceVersionSnapshot,
} from "@/lib/services/serviceCatalogueShared";

function snapshot(
  overrides: Partial<ServiceVersionSnapshot> = {}
): ServiceVersionSnapshot {
  return {
    name_snapshot: "Oil change",
    category_snapshot: "Oil & Fluids",
    pricing_mode: "fixed_package",
    fixed_package_price_cents: 12050,
    default_labor_minutes: 90,
    ...overrides,
  };
}

describe("nextServiceVersionNo", () => {
  it("starts at 1 when no versions exist", () => {
    expect(nextServiceVersionNo(null)).toBe(1);
    expect(nextServiceVersionNo(undefined)).toBe(1);
  });

  it("bumps the previous max by one", () => {
    expect(nextServiceVersionNo(1)).toBe(2);
    expect(nextServiceVersionNo(7)).toBe(8);
  });

  it("recovers from bad stored values", () => {
    expect(nextServiceVersionNo(-3)).toBe(1);
    expect(nextServiceVersionNo(Number.NaN)).toBe(1);
  });
});

describe("buildServiceVersionSnapshot", () => {
  it("converts legacy dollars and hours to cents and minutes", () => {
    expect(
      buildServiceVersionSnapshot({
        name: "Oil change",
        category: "Oil & Fluids",
        standard_price: 120.5,
        estimated_labour: 1.5,
      })
    ).toEqual({
      name_snapshot: "Oil change",
      category_snapshot: "Oil & Fluids",
      pricing_mode: "fixed_package",
      fixed_package_price_cents: 12050,
      default_labor_minutes: 90,
    });
  });

  it("keeps null price and labour as null (missing, not zero)", () => {
    const built = buildServiceVersionSnapshot({
      name: "Diagnostic",
      category: null,
      standard_price: null,
      estimated_labour: null,
    });
    expect(built.fixed_package_price_cents).toBeNull();
    expect(built.default_labor_minutes).toBeNull();
    expect(built.category_snapshot).toBeNull();
  });

  it("honours an explicit pricing mode", () => {
    expect(
      buildServiceVersionSnapshot({
        name: "Custom",
        category: null,
        standard_price: 10,
        estimated_labour: null,
        pricing_mode: "itemized",
      }).pricing_mode
    ).toBe("itemized");
  });

  it("rounds fractional cents and minutes", () => {
    const built = buildServiceVersionSnapshot({
      name: "Odd",
      category: null,
      standard_price: 19.999,
      estimated_labour: 0.33,
    });
    expect(built.fixed_package_price_cents).toBe(2000);
    expect(built.default_labor_minutes).toBe(20);
  });
});

describe("shouldWriteServiceVersion", () => {
  it("always versions a brand-new service", () => {
    expect(shouldWriteServiceVersion(null, snapshot())).toBe(true);
  });

  it("skips no-op re-saves", () => {
    expect(shouldWriteServiceVersion(snapshot(), snapshot())).toBe(false);
  });

  it("versions when any snapshot field changes", () => {
    expect(
      shouldWriteServiceVersion(snapshot(), snapshot({ name_snapshot: "Renamed" }))
    ).toBe(true);
    expect(
      shouldWriteServiceVersion(snapshot(), snapshot({ category_snapshot: null }))
    ).toBe(true);
    expect(
      shouldWriteServiceVersion(
        snapshot(),
        snapshot({ fixed_package_price_cents: 13000 })
      )
    ).toBe(true);
    expect(
      shouldWriteServiceVersion(snapshot(), snapshot({ default_labor_minutes: 120 }))
    ).toBe(true);
    expect(
      shouldWriteServiceVersion(snapshot(), snapshot({ pricing_mode: "itemized" }))
    ).toBe(true);
  });

  it("treats null and missing numeric fields as equal", () => {
    expect(
      shouldWriteServiceVersion(
        snapshot({ fixed_package_price_cents: null, default_labor_minutes: null }),
        snapshot({ fixed_package_price_cents: null, default_labor_minutes: null })
      )
    ).toBe(false);
  });
});
