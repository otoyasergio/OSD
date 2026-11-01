import { describe, it, expect } from "vitest";
import {
  DEFAULT_SHOP_HOURLY_RATE,
  defaultServiceLinePrice,
  labourPriceFromHours,
  normalizeShopHourlyRate,
  resolveShopHourlyRate,
  suggestedPriceFromLabourHours,
} from "@/lib/pricing/shopRate";

describe("shopRate", () => {
  it("defaults to the current shop rate of $156/h", () => {
    expect(DEFAULT_SHOP_HOURLY_RATE).toBe(156);
  });

  it("normalizes a valid owner-entered rate", () => {
    expect(normalizeShopHourlyRate("156")).toBe(156);
    expect(normalizeShopHourlyRate("156.50")).toBe(156.5);
    expect(normalizeShopHourlyRate(200)).toBe(200);
    expect(normalizeShopHourlyRate("0")).toBeNull();
    expect(normalizeShopHourlyRate("-10")).toBeNull();
    expect(normalizeShopHourlyRate("")).toBeNull();
  });

  it("falls back to the default shop rate when the setting is missing", () => {
    expect(resolveShopHourlyRate(null)).toBe(156);
    expect(resolveShopHourlyRate(undefined)).toBe(156);
    expect(resolveShopHourlyRate(180)).toBe(180);
  });

  it("computes labour price from hours at the given shop rate", () => {
    expect(labourPriceFromHours(1, 156)).toBe(156);
    expect(labourPriceFromHours(1.5, 156)).toBe(234);
    expect(labourPriceFromHours(0.25, 156)).toBe(39);
    expect(labourPriceFromHours(1, 180)).toBe(180);
    expect(labourPriceFromHours(null, 156)).toBeNull();
  });

  it("suggests price from labour hours string at the given shop rate", () => {
    expect(suggestedPriceFromLabourHours("2", 156)).toBe("312");
    expect(suggestedPriceFromLabourHours("2", 180)).toBe("360");
    expect(suggestedPriceFromLabourHours("")).toBe("");
  });

  it("prefers catalogue price over rate when set", () => {
    expect(
      defaultServiceLinePrice({
        cataloguePrice: 99,
        catalogueLabour: 1,
        labourHours: "1",
        hourlyRate: 156,
      })
    ).toBe("99");
  });

  it("falls back to hours × shop rate when catalogue price is null", () => {
    expect(
      defaultServiceLinePrice({
        cataloguePrice: null,
        catalogueLabour: 1,
        labourHours: "1",
        hourlyRate: 156,
      })
    ).toBe("156");
  });
});

describe("isFlatRateService", () => {
  it("treats Storage category as flat rate", async () => {
    const { isFlatRateService } = await import("@/lib/pricing/shopRate");
    expect(isFlatRateService({ category: "Storage", name: "Winter Storage" })).toBe(true);
    expect(isFlatRateService({ category: "Maintenance", name: "Oil Change" })).toBe(
      false
    );
  });
});
