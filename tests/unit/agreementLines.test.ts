import { describe, expect, it } from "vitest";
import { linesFromConfirmedAgreement } from "@/lib/billing/agreementLines";
import { HST_LINE_NAME } from "@/lib/pricing/hst";

describe("linesFromConfirmedAgreement", () => {
  it("bills the confirmed version with its captured HST instead of live job snapshots", () => {
    const lines = linesFromConfirmedAgreement({
      confirmed: {
        preTaxLines: [{ name: "Oil change", amountCents: 14500 }],
        hstCents: 1885,
      },
      addedWorkPreTax: [],
      estimateFeeCents: 5000,
      legacyPreTax: [{ name: "Changed later", amount: 999 }],
    });
    expect(lines).toEqual([
      { name: "Oil change", amount: 145 },
      { name: HST_LINE_NAME, amount: 18.85 },
    ]);
  });

  it("adds work started under a recorded maximum after the version was confirmed", () => {
    const lines = linesFromConfirmedAgreement({
      confirmed: {
        preTaxLines: [{ name: "Oil change", amountCents: 14500 }],
        hstCents: 1885,
      },
      addedWorkPreTax: [{ name: "Chain adjustment", amount: 40 }],
      estimateFeeCents: 0,
      legacyPreTax: [],
    });
    expect(lines).toEqual([
      { name: "Oil change", amount: 145 },
      { name: "Chain adjustment", amount: 40 },
      { name: HST_LINE_NAME, amount: 24.05 },
    ]);
  });

  it("charges a disclosed estimate fee only when nothing chargeable is on the bill", () => {
    const declined = linesFromConfirmedAgreement({
      confirmed: { preTaxLines: [], hstCents: 0 },
      addedWorkPreTax: [],
      estimateFeeCents: 4000,
      legacyPreTax: [],
    });
    expect(declined).toEqual([
      { name: "Estimate fee", amount: 40 },
      { name: HST_LINE_NAME, amount: 5.2 },
    ]);

    const noVersion = linesFromConfirmedAgreement({
      confirmed: null,
      addedWorkPreTax: [],
      estimateFeeCents: 4000,
      legacyPreTax: [],
    });
    expect(noVersion.find((line) => line.name === "Estimate fee")?.amount).toBe(40);
    expect(noVersion.some((line) => line.name === HST_LINE_NAME)).toBe(true);
  });
});
