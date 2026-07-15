import { describe, it, expect } from "vitest";
import {
  HST_RATE,
  HST_LINE_NAME,
  appendHstLine,
  estimateTotalsWithHst,
  hstAmount,
  withHst,
  withHstCents,
} from "@/lib/pricing/hst";

describe("Ontario HST", () => {
  it("uses 13% as the shop rate", () => {
    expect(HST_RATE).toBe(0.13);
  });

  it("adds 13% HST to a known subtotal", () => {
    expect(hstAmount(100)).toBe(13);
    expect(withHst(100)).toEqual({ subtotal: 100, hst: 13, total: 113 });
    expect(withHstCents(10_000)).toEqual({
      subtotalCents: 10_000,
      hstCents: 1_300,
      totalCents: 11_300,
    });
  });

  it("rounds HST to the nearest cent", () => {
    // 99.99 × 0.13 = 12.9987 → $13.00
    expect(hstAmount(99.99)).toBe(13);
    expect(withHst(99.99).total).toBe(112.99);
    // 10.01 × 0.13 = 1.3013 → $1.30
    expect(withHstCents(1001)).toEqual({
      subtotalCents: 1001,
      hstCents: 130,
      totalCents: 1131,
    });
  });

  it("builds estimate totals from merchandise dollars", () => {
    expect(estimateTotalsWithHst(200)).toEqual({
      subtotalCents: 20_000,
      hstCents: 2_600,
      totalCents: 22_600,
    });
  });

  it("appends an HST line for Square invoices", () => {
    const lines = appendHstLine([
      { name: "Oil change", amount: 145 },
      { name: "Filter × 1", amount: 25 },
    ]);
    expect(lines).toEqual([
      { name: "Oil change", amount: 145 },
      { name: "Filter × 1", amount: 25 },
      { name: HST_LINE_NAME, amount: 22.1 },
    ]);
  });

  it("skips HST when there is no taxable merchandise", () => {
    expect(appendHstLine([])).toEqual([]);
    expect(appendHstLine([{ name: "Free", amount: 0 }])).toEqual([
      { name: "Free", amount: 0 },
    ]);
    expect(withHst(0).total).toBe(0);
  });
});
