import { describe, expect, it } from "vitest";
import {
  assertCatalogDtcCodesUnique,
  computeVerdict,
  type CatalogEntry,
} from "@/lib/diagnostics/verdict";

const catalog: CatalogEntry[] = [
  {
    dtc_code: "P0217",
    severity_hint: "P0",
    description:
      "Engine coolant critically overheated — stop riding, let the engine cool.",
  },
  { dtc_code: "C0035", severity_hint: "P1", description: "Anti-lock braking fault." },
  { dtc_code: "P0562", severity_hint: "P3", description: "System voltage slightly low." },
];

describe("computeVerdict", () => {
  it("treats an empty scan as Healthy", () => {
    expect(computeVerdict([], catalog)).toEqual({ tier: "Healthy" });
  });

  it("returns Unrecognised with no severity fields when every code is unknown", () => {
    const verdict = computeVerdict([{ code: "B1234" }, { code: "U0100" }], catalog);

    expect(verdict).toEqual({
      tier: "Unrecognised",
      unrecognisedCodes: ["B1234", "U0100"],
    });
    expect(verdict).not.toHaveProperty("severity");
    expect(verdict).not.toHaveProperty("severity_hint");
    expect(verdict).not.toHaveProperty("severityHint");
    expect(verdict).not.toHaveProperty("level");
  });

  it("picks the highest severity and ignores reading order", () => {
    const readings = [{ code: "P0562" }, { code: "P0217" }, { code: "C0035" }];

    expect(computeVerdict(readings, catalog).tier).toBe("P0");
    expect(computeVerdict([...readings].reverse(), catalog).tier).toBe("P0");
  });

  it("keeps a known severity and lists the codes the catalog does not recognise", () => {
    expect(computeVerdict([{ code: "C0035" }, { code: "ZZZ" }], catalog)).toEqual({
      tier: "P1",
      unrecognisedCodes: ["ZZZ"],
    });
  });
});

describe("assertCatalogDtcCodesUnique", () => {
  it("returns nothing when every code appears once", () => {
    expect(assertCatalogDtcCodesUnique(catalog)).toEqual([]);
  });

  it("reports a code that appears more than once", () => {
    expect(
      assertCatalogDtcCodesUnique([
        ...catalog,
        { dtc_code: "P0217", severity_hint: "P3", description: "A quieter reading." },
      ])
    ).toEqual([{ dtc_code: "P0217" }]);
  });
});
