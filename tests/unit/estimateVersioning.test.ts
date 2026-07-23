import { describe, expect, it } from "vitest";
import {
  buildEstimateVersionSnapshot,
  presentationBlockers,
  type EstimateJobDraft,
} from "@/lib/services/estimatePricing";

function draftJobA(): EstimateJobDraft {
  return {
    jobId: "job-a",
    title: "Brake service",
    description: "Front pads and rotors",
    pricing: {
      pricingMode: "itemized",
      fixedPackagePriceCents: null,
      laborLines: [{ amountCents: 20000, billable: true, includedInPackage: false }],
      partLines: [{ quantity: 1, sellPriceCents: 5000, includedInPackage: false }],
      feeLines: [{ amountCents: 1000 }],
      discountLines: [],
    },
  };
}

function draftJobB(): EstimateJobDraft {
  return {
    jobId: "job-b",
    title: "Oil change package",
    description: null,
    pricing: {
      pricingMode: "fixed_package",
      fixedPackagePriceCents: 10000,
      laborLines: [{ amountCents: 4000, billable: true, includedInPackage: true }],
      partLines: [{ quantity: 1, sellPriceCents: 2500, includedInPackage: true }],
      feeLines: [],
      discountLines: [],
    },
  };
}

function draftJobC(): EstimateJobDraft {
  return {
    jobId: "job-c",
    title: "Chain adjustment",
    description: null,
    pricing: {
      pricingMode: "itemized",
      fixedPackagePriceCents: null,
      laborLines: [{ amountCents: 5000, billable: true, includedInPackage: false }],
      partLines: [],
      feeLines: [],
      discountLines: [],
    },
  };
}

describe("buildEstimateVersionSnapshot", () => {
  it("prices the QA fixture and freezes the totals", () => {
    const snapshot = buildEstimateVersionSnapshot([
      draftJobA(),
      draftJobB(),
      draftJobC(),
    ]);
    expect(snapshot.totals.subtotalCents).toBe(41000);
    expect(snapshot.totals.taxCents).toBe(5330);
    expect(snapshot.totals.totalCents).toBe(46330);
    expect(snapshot.jobs).toHaveLength(3);
    expect(snapshot.jobs.map((j) => j.displayOrder)).toEqual([0, 1, 2]);
  });

  it("emits one package line for package jobs, not included components", () => {
    const snapshot = buildEstimateVersionSnapshot([draftJobB()]);
    const kinds = snapshot.lines.map((line) => line.kind);
    expect(kinds).toEqual(["package"]);
    expect(snapshot.lines[0].extended_amount_cents).toBe(10000);
  });

  it("keeps line positions sequential across jobs", () => {
    const snapshot = buildEstimateVersionSnapshot([draftJobA(), draftJobC()]);
    expect(snapshot.lines.map((line) => line.position)).toEqual(
      snapshot.lines.map((_, i) => i)
    );
  });

  it("carries each job's tax on its final line so line sums equal totals", () => {
    const snapshot = buildEstimateVersionSnapshot([
      draftJobA(),
      draftJobB(),
      draftJobC(),
    ]);
    const taxSum = snapshot.lines.reduce((sum, line) => sum + line.tax_amount_cents, 0);
    expect(taxSum).toBe(snapshot.totals.taxCents);
    const extendedSum = snapshot.lines.reduce(
      (sum, line) => sum + line.extended_amount_cents,
      0
    );
    expect(extendedSum).toBe(snapshot.totals.subtotalCents);
  });

  it("produces a stable content hash for identical input", () => {
    const a = buildEstimateVersionSnapshot([draftJobA(), draftJobB()]);
    const b = buildEstimateVersionSnapshot([draftJobA(), draftJobB()]);
    expect(a.contentHash).toBe(b.contentHash);
  });

  it("changes the content hash when any price or scope changes", () => {
    const base = buildEstimateVersionSnapshot([draftJobA()]);

    const repriced = draftJobA();
    repriced.pricing.laborLines[0].amountCents = 21000;
    expect(buildEstimateVersionSnapshot([repriced]).contentHash).not.toBe(
      base.contentHash
    );

    const rescoped = buildEstimateVersionSnapshot([draftJobA(), draftJobC()]);
    expect(rescoped.contentHash).not.toBe(base.contentHash);

    const reordered = buildEstimateVersionSnapshot([draftJobC(), draftJobA()]);
    expect(reordered.contentHash).not.toBe(rescoped.contentHash);
  });

  it("emits negative discount lines that reduce line sums to the subtotal", () => {
    const discounted: EstimateJobDraft = {
      ...draftJobA(),
      pricing: { ...draftJobA().pricing, discountLines: [{ amountCents: 2000 }] },
    };
    const snapshot = buildEstimateVersionSnapshot([discounted]);
    const discountLine = snapshot.lines.find((line) => line.kind === "discount");
    expect(discountLine?.extended_amount_cents).toBe(-2000);
    const extendedSum = snapshot.lines.reduce(
      (sum, line) => sum + line.extended_amount_cents,
      0
    );
    expect(extendedSum).toBe(snapshot.totals.subtotalCents);
    expect(snapshot.totals.subtotalCents).toBe(24000);
  });
});

describe("presentationBlockers", () => {
  it("blocks empty estimates", () => {
    const snapshot = buildEstimateVersionSnapshot([]);
    expect(presentationBlockers(snapshot)).toContain("ESTIMATE_EMPTY");
  });

  it("blocks presentation while any part price is missing", () => {
    const missing: EstimateJobDraft = {
      ...draftJobA(),
      pricing: {
        ...draftJobA().pricing,
        partLines: [{ quantity: 1, sellPriceCents: null, includedInPackage: false }],
      },
    };
    const snapshot = buildEstimateVersionSnapshot([missing]);
    expect(presentationBlockers(snapshot)).toContain("ESTIMATE_MISSING_PRICES");
  });

  it("passes a complete snapshot", () => {
    const snapshot = buildEstimateVersionSnapshot([draftJobA(), draftJobB()]);
    expect(presentationBlockers(snapshot)).toEqual([]);
  });
});
