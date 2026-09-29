import { describe, expect, it } from "vitest";
import {
  DEFAULT_DIAGNOSTICS_MAX_OUTPUT_TOKENS,
  DEFAULT_DIAGNOSTICS_MODEL,
  DEFAULT_DIAGNOSTICS_TIMEOUT_MS,
  getDiagnosticsConfig,
  getDiagnosticsTimeoutMs,
  isDiagnosticsAiConfigured,
} from "@/lib/diagnostics/config";

describe("diagnostics AI configuration", () => {
  it("uses the documented flagship alias with bounded defaults", () => {
    expect(getDiagnosticsConfig({ OPENAI_API_KEY: " test-key " })).toEqual({
      apiKey: "test-key",
      model: DEFAULT_DIAGNOSTICS_MODEL,
      timeoutMs: DEFAULT_DIAGNOSTICS_TIMEOUT_MS,
      maxOutputTokens: DEFAULT_DIAGNOSTICS_MAX_OUTPUT_TOKENS,
    });
    expect(DEFAULT_DIAGNOSTICS_MAX_OUTPUT_TOKENS).toBe(28_000);
    expect(DEFAULT_DIAGNOSTICS_MAX_OUTPUT_TOKENS).toBeGreaterThanOrEqual(24_000);
    expect(DEFAULT_DIAGNOSTICS_MAX_OUTPUT_TOKENS).toBeLessThanOrEqual(32_768);
  });

  it("accepts explicit emergency overrides", () => {
    expect(
      getDiagnosticsConfig({
        OPENAI_API_KEY: "key",
        OTOMOTO_DIAGNOSTICS_MODEL: "gpt-6-sol",
        OTOMOTO_DIAGNOSTICS_TIMEOUT_MS: "30000",
        OTOMOTO_DIAGNOSTICS_MAX_OUTPUT_TOKENS: "2048",
      })
    ).toMatchObject({
      model: "gpt-6-sol",
      timeoutMs: 30_000,
      maxOutputTokens: 2_048,
    });
  });

  it("reads the maximum configured timeout without requiring provider credentials", () => {
    expect(
      getDiagnosticsTimeoutMs({
        OTOMOTO_DIAGNOSTICS_TIMEOUT_MS: "120000",
      })
    ).toBe(120_000);
  });

  it("fails clearly when the server key is missing", () => {
    expect(() => getDiagnosticsConfig({})).toThrow("DIAGNOSTICS_AI_NOT_CONFIGURED");
    expect(isDiagnosticsAiConfigured({ OPENAI_API_KEY: " " })).toBe(false);
  });

  it("rejects malformed or out-of-range overrides", () => {
    expect(() =>
      getDiagnosticsConfig({
        OPENAI_API_KEY: "key",
        OTOMOTO_DIAGNOSTICS_MODEL: "not a model",
      })
    ).toThrow("DIAGNOSTICS_AI_MODEL_INVALID");

    expect(() =>
      getDiagnosticsConfig({
        OPENAI_API_KEY: "key",
        OTOMOTO_DIAGNOSTICS_TIMEOUT_MS: "999",
      })
    ).toThrow("DIAGNOSTICS_AI_TIMEOUT_INVALID");

    expect(
      getDiagnosticsConfig({
        OPENAI_API_KEY: "key",
        OTOMOTO_DIAGNOSTICS_MAX_OUTPUT_TOKENS: "32768",
      }).maxOutputTokens
    ).toBe(32_768);
    expect(() =>
      getDiagnosticsConfig({
        OPENAI_API_KEY: "key",
        OTOMOTO_DIAGNOSTICS_MAX_OUTPUT_TOKENS: "32769",
      })
    ).toThrow("DIAGNOSTICS_AI_OUTPUT_LIMIT_INVALID");
  });
});
