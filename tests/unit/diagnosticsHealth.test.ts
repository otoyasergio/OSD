import { describe, expect, it } from "vitest";
import { askOtomotoHealthStatus } from "@/lib/diagnostics/health";
import { summarizeIntegrationHealth } from "@/lib/services/healthStatus";

describe("Ask OTOMOTO health status", () => {
  it("reports valid server-only configuration as healthy", () => {
    expect(
      askOtomotoHealthStatus({
        OPENAI_API_KEY: "server-secret",
        OTOMOTO_DIAGNOSTICS_MODEL: "gpt-6-astra",
      })
    ).toBe("ok");
  });

  it("distinguishes missing configuration from invalid settings", () => {
    expect(askOtomotoHealthStatus({})).toBe("missing");
    expect(
      askOtomotoHealthStatus({
        OPENAI_API_KEY: "server-secret",
        OTOMOTO_DIAGNOSTICS_TIMEOUT_MS: "1",
      })
    ).toBe("error");
  });

  it("reports missing AI as degraded without declaring the workshop down", () => {
    expect(
      summarizeIntegrationHealth({
        supabase: "ok",
        wix: "ok",
        partsCanada: "ok",
        cron: "ok",
        askOtomoto: "missing",
      })
    ).toEqual({ ok: true, degraded: true });
  });

  it("fails overall health when a core integration is unavailable", () => {
    expect(
      summarizeIntegrationHealth({
        supabase: "error",
        wix: "ok",
        partsCanada: "ok",
        cron: "ok",
        askOtomoto: "ok",
      })
    ).toEqual({ ok: false, degraded: false });
  });
});
