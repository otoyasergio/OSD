import { describe, expect, it } from "vitest";
import {
  buildDiagnosticsContextBlock,
  DIAGNOSTICS_MAX_CONTEXT_BLOCK_CHARS,
  hashDiagnosticsContext,
  shapeDiagnosticsContext,
} from "@/lib/diagnostics/context";
import { diagnosticsAudienceForMode } from "@/lib/diagnostics/prompts";
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

  it("maps every scenario mode to its expected shaped audience", () => {
    const expectedAudience = {
      shop: "technical",
      teach: "technical",
      report: "technical",
      intake: "front_office",
      advisor: "front_office",
    } as const;

    for (const scenario of DIAGNOSTICS_EVAL_SCENARIOS) {
      const shaped = shapeDiagnosticsContext(scenario.context, {
        mode: scenario.mode,
        workOrderId: scenario.context.workOrder.workOrderId,
        jobId: scenario.context.jobs[0]?.jobId ?? null,
        serverNowIso: "2026-09-29T08:00:00.000Z",
      });

      expect(diagnosticsAudienceForMode(scenario.mode)).toBe(
        expectedAudience[scenario.mode]
      );
      expect(shaped.context.mode).toBe(scenario.mode);
      expect(shaped.context.audience).toBe(expectedAudience[scenario.mode]);
    }
  });

  it("shapes and serializes every fictional context within normal-CI safety bounds", () => {
    for (const scenario of DIAGNOSTICS_EVAL_SCENARIOS) {
      const shaped = shapeDiagnosticsContext(scenario.context, {
        mode: scenario.mode,
        workOrderId: scenario.context.workOrder.workOrderId,
        jobId: scenario.context.jobs[0]?.jobId ?? null,
        serverNowIso: "2026-09-29T08:00:00.000Z",
      });
      const rebuilt = buildDiagnosticsContextBlock(shaped.context);

      expect(rebuilt).toBe(shaped.contextBlock);
      expect(hashDiagnosticsContext(shaped.context)).toBe(shaped.contextHash);
      expect(rebuilt.length).toBeLessThanOrEqual(DIAGNOSTICS_MAX_CONTEXT_BLOCK_CHARS);
      expect(rebuilt).not.toMatch(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/i);
      expect(rebuilt).not.toMatch(/\+1[ .()-]*\d{3}[ .()-]*\d{3}[ .()-]*\d{4}/);
      expect(rebuilt).not.toMatch(
        /"(?:email|phone|address|vin|signature|storagePath|photoUrl)":/i
      );
    }
  });
});
