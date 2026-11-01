import { describe, expect, it } from "vitest";
import { linesFromConfirmedAgreement } from "@/lib/billing/agreementLines";

describe("linesFromConfirmedAgreement", () => {
  it("bills the confirmed version, including its HST line, instead of live job snapshots", () => {
    const lines = linesFromConfirmedAgreement({
      confirmedLines: [
        { name: "Oil change", amountCents: 14500 },
        { name: "HST (13%)", amountCents: 1885 },
      ],
      estimateFeeCents: 5000,
      legacyPreTax: [{ name: "Changed later", amount: 999 }],
    });
    expect(lines.map((line) => line.name)).toContain("Oil change");
    expect(lines.map((line) => line.name)).not.toContain("Changed later");
    expect(lines.find((line) => line.name === "Oil change")?.amount).toBe(145);
    expect(lines.find((line) => line.name === "Estimate fee")).toBeUndefined();
  });

  it("adds a disclosed estimate fee only when the confirmed repair does not proceed", () => {
    const lines = linesFromConfirmedAgreement({
      confirmedLines: null,
      estimateFeeCents: 4000,
      legacyPreTax: [],
    });
    expect(lines.find((line) => line.name === "Estimate fee")?.amount).toBe(40);
    expect(lines.some((line) => line.name.startsWith("HST"))).toBe(true);
  });
});
