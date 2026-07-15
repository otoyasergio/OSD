import { describe, it, expect } from "vitest";
import {
  SHOP_HOURLY_RATE,
  defaultServiceLinePrice,
  labourPriceFromHours,
  suggestedPriceFromLabourHours,
} from "@/lib/pricing/shopRate";

describe("shopRate", () => {
  it("uses the contract shop rate of $145/h", () => {
    expect(SHOP_HOURLY_RATE).toBe(145);
  });

  it("computes labour price from hours", () => {
    expect(labourPriceFromHours(1)).toBe(145);
    expect(labourPriceFromHours(1.5)).toBe(217.5);
    expect(labourPriceFromHours(0.25)).toBe(36.25);
    expect(labourPriceFromHours(null)).toBeNull();
  });

  it("suggests price from labour hours string", () => {
    expect(suggestedPriceFromLabourHours("2")).toBe("290");
    expect(suggestedPriceFromLabourHours("")).toBe("");
  });

  it("prefers catalogue price over rate when set", () => {
    expect(
      defaultServiceLinePrice({
        cataloguePrice: 99,
        catalogueLabour: 1,
        labourHours: "1",
      })
    ).toBe("99");
  });

  it("falls back to hours × shop rate when catalogue price is null", () => {
    expect(
      defaultServiceLinePrice({
        cataloguePrice: null,
        catalogueLabour: 1,
        labourHours: "1",
      })
    ).toBe("145");
  });
});

describe("isFlatRateService", () => {
  it("treats Storage category as flat rate", async () => {
    const { isFlatRateService } = await import("@/lib/pricing/shopRate");
    expect(isFlatRateService({ category: "Storage", name: "Winter Storage" })).toBe(
      true
    );
    expect(isFlatRateService({ category: "Maintenance", name: "Oil Change" })).toBe(
      false
    );
  });
});
