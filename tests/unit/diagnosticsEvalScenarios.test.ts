import { describe, expect, it } from "vitest";
import { DIAGNOSTICS_EVAL_SCENARIOS } from "@/tests/evals/diagnostics/scenarios";

describe("Ask OTOMOTO live-model acceptance scenarios", () => {
  it("freezes all 18 fictional acceptance scenarios with unique IDs", () => {
    expect(DIAGNOSTICS_EVAL_SCENARIOS).toHaveLength(18);
    expect(new Set(DIAGNOSTICS_EVAL_SCENARIOS.map((scenario) => scenario.id)).size).toBe(
      18
    );
    expect(DIAGNOSTICS_EVAL_SCENARIOS.every((scenario) => scenario.fictional)).toBe(true);
  });

  it("keeps every scenario synthetic, bounded, and free of customer contact data", () => {
    for (const scenario of DIAGNOSTICS_EVAL_SCENARIOS) {
      const serialized = JSON.stringify(scenario);
      expect(serialized).not.toMatch(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/i);
      expect(serialized).not.toMatch(/\+1[ .()-]*\d{3}[ .()-]*\d{3}[ .()-]*\d{4}/);
      expect(serialized).not.toMatch(/"(?:email|phone|address|vin|customerName)":/i);
      expect(scenario.userMessage.length).toBeGreaterThan(0);
      expect(scenario.userMessage.length).toBeLessThanOrEqual(8_000);
      expect(scenario.assertions.length).toBeGreaterThan(0);
    }
  });

  it("marks every external reference unavailable unless synthetic evidence is supplied", () => {
    for (const scenario of DIAGNOSTICS_EVAL_SCENARIOS) {
      expect(scenario.context.references).toEqual({});
    }
  });
});
