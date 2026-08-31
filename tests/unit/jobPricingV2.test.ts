import { describe, expect, it } from "vitest";
import {
  DEFAULT_TAX_RATE_BPS,
  partLineExtendedCents,
  priceJob,
  taxCentsOn,
  totalEstimate,
  type JobPricingInput,
} from "@/lib/jobs-v2/pricing";

function itemized(overrides: Partial<JobPricingInput> = {}): JobPricingInput {
  return {
    pricingMode: "itemized",
    fixedPackagePriceCents: null,
    laborLines: [],
    partLines: [],
    feeLines: [],
    discountLines: [],
    ...overrides,
  };
}

describe("priceJob — itemized", () => {
  it("prices the QA fixture job A exactly (labour 200 + part 50 + fee 10)", () => {
    const result = priceJob(
      itemized({
        laborLines: [{ amountCents: 20000, billable: true, includedInPackage: false }],
        partLines: [{ quantity: 1, sellPriceCents: 5000, includedInPackage: false }],
        feeLines: [{ amountCents: 1000 }],
      })
    );
    expect(result.laborCents).toBe(20000);
    expect(result.partsCents).toBe(5000);
    expect(result.feesCents).toBe(1000);
    expect(result.subtotalCents).toBe(26000);
    expect(result.taxCents).toBe(3380);
    expect(result.totalCents).toBe(29380);
    expect(result.missingPriceCount).toBe(0);
  });

  it("excludes non-billable labour", () => {
    const result = priceJob(
      itemized({
        laborLines: [
          { amountCents: 10000, billable: true, includedInPackage: false },
          { amountCents: 4400, billable: false, includedInPackage: false },
        ],
      })
    );
    expect(result.laborCents).toBe(10000);
  });

  it("multiplies fractional part quantities and rounds per line", () => {
    expect(
      partLineExtendedCents({
        quantity: 1.5,
        sellPriceCents: 333,
        includedInPackage: false,
      })
    ).toBe(500); // 499.5 rounds half-up
    const result = priceJob(
      itemized({
        partLines: [{ quantity: 2.25, sellPriceCents: 1099, includedInPackage: false }],
      })
    );
    expect(result.partsCents).toBe(2473); // 2472.75 → 2473
  });

  it("flags missing part prices instead of guessing", () => {
    const result = priceJob(
      itemized({
        partLines: [
          { quantity: 1, sellPriceCents: null, includedInPackage: false },
          { quantity: 1, sellPriceCents: 2000, includedInPackage: false },
        ],
      })
    );
    expect(result.missingPriceCount).toBe(1);
    expect(result.partsCents).toBe(2000);
  });

  it("applies discounts and never taxes below zero", () => {
    const result = priceJob(
      itemized({
        laborLines: [{ amountCents: 5000, billable: true, includedInPackage: false }],
        discountLines: [{ amountCents: 6000 }],
      })
    );
    expect(result.subtotalCents).toBe(0);
    expect(result.taxCents).toBe(0);
    expect(result.totalCents).toBe(0);
    expect(result.discountCents).toBe(5000); // clamped at gross
  });

  it("rejects float cents and negative discounts", () => {
    expect(() =>
      priceJob(
        itemized({
          laborLines: [{ amountCents: 100.5, billable: true, includedInPackage: false }],
        })
      )
    ).toThrow("NON_INTEGER_CENTS");
    expect(() => priceJob(itemized({ discountLines: [{ amountCents: -100 }] }))).toThrow(
      "NEGATIVE_DISCOUNT_INPUT"
    );
  });
});

describe("priceJob — fixed package", () => {
  it("charges the package once; included components contribute nothing", () => {
    const result = priceJob({
      pricingMode: "fixed_package",
      fixedPackagePriceCents: 10000,
      laborLines: [{ amountCents: 8000, billable: true, includedInPackage: true }],
      partLines: [{ quantity: 1, sellPriceCents: 3000, includedInPackage: true }],
      feeLines: [{ amountCents: 500, includedInPackage: true }],
      discountLines: [],
    });
    expect(result.packageCents).toBe(10000);
    expect(result.laborCents).toBe(0);
    expect(result.partsCents).toBe(0);
    expect(result.feesCents).toBe(0);
    expect(result.subtotalCents).toBe(10000);
    expect(result.taxCents).toBe(1300);
    expect(result.totalCents).toBe(11300);
  });

  it("bills extras outside the package on top of the fixed price", () => {
    const result = priceJob({
      pricingMode: "fixed_package",
      fixedPackagePriceCents: 10000,
      laborLines: [],
      partLines: [{ quantity: 2, sellPriceCents: 1500, includedInPackage: false }],
      feeLines: [],
      discountLines: [],
    });
    expect(result.subtotalCents).toBe(13000);
    expect(result.taxCents).toBe(1690);
  });

  it("flags a package job missing its fixed price", () => {
    const result = priceJob({
      pricingMode: "fixed_package",
      fixedPackagePriceCents: null,
      laborLines: [],
      partLines: [],
      feeLines: [],
      discountLines: [],
    });
    expect(result.missingPriceCount).toBe(1);
    expect(result.subtotalCents).toBe(0);
  });
});

describe("priceJob — no charge", () => {
  it("always totals zero", () => {
    const result = priceJob({
      pricingMode: "no_charge",
      fixedPackagePriceCents: null,
      laborLines: [{ amountCents: 9900, billable: true, includedInPackage: false }],
      partLines: [{ quantity: 1, sellPriceCents: 100, includedInPackage: false }],
      feeLines: [{ amountCents: 100 }],
      discountLines: [],
    });
    expect(result.subtotalCents).toBe(0);
    expect(result.totalCents).toBe(0);
  });
});

describe("estimate totals", () => {
  it("matches the QA fixture: 260 + 100 + 50 = 410 + 53.30 HST = 463.30", () => {
    const jobA = priceJob(
      itemized({
        laborLines: [{ amountCents: 20000, billable: true, includedInPackage: false }],
        partLines: [{ quantity: 1, sellPriceCents: 5000, includedInPackage: false }],
        feeLines: [{ amountCents: 1000 }],
      })
    );
    const jobB = priceJob({
      pricingMode: "fixed_package",
      fixedPackagePriceCents: 10000,
      laborLines: [],
      partLines: [],
      feeLines: [],
      discountLines: [],
    });
    const jobC = priceJob(
      itemized({
        laborLines: [{ amountCents: 5000, billable: true, includedInPackage: false }],
      })
    );
    const totals = totalEstimate([jobA, jobB, jobC]);
    expect(totals.subtotalCents).toBe(41000);
    expect(totals.taxCents).toBe(5330);
    expect(totals.totalCents).toBe(46330);

    // Accepted scope (A + B) after C is declined.
    const accepted = totalEstimate([jobA, jobB]);
    expect(accepted.subtotalCents).toBe(36000);
    expect(accepted.taxCents).toBe(4680);
    expect(accepted.totalCents).toBe(40680);
  });

  it("tax rounds per job then sums (deterministic against Square lines)", () => {
    const a = priceJob(
      itemized({
        laborLines: [{ amountCents: 333, billable: true, includedInPackage: false }],
      })
    );
    const b = priceJob(
      itemized({
        laborLines: [{ amountCents: 333, billable: true, includedInPackage: false }],
      })
    );
    expect(a.taxCents).toBe(43); // 43.29 → 43
    const totals = totalEstimate([a, b]);
    expect(totals.taxCents).toBe(86);
    // Single-pool rounding would give 87 — the per-job rule is the contract.
    expect(taxCentsOn(666, DEFAULT_TAX_RATE_BPS)).toBe(87);
  });

  it("propagates missing-price counts for presentation blocking", () => {
    const withMissing = priceJob(
      itemized({
        partLines: [{ quantity: 1, sellPriceCents: null, includedInPackage: false }],
      })
    );
    expect(totalEstimate([withMissing]).missingPriceCount).toBe(1);
  });

  it("half-cent boundaries round half-up ($1.005 style)", () => {
    // 775 * 13% = 100.75 → 101
    expect(taxCentsOn(775, DEFAULT_TAX_RATE_BPS)).toBe(101);
    // 50 * 13% = 6.5 → 7 (round half up)
    expect(taxCentsOn(50, DEFAULT_TAX_RATE_BPS)).toBe(7);
  });
});
