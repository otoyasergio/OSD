import { describe, expect, it } from "vitest";
import { askOtomotoHealthStatus } from "@/lib/diagnostics/health";

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
});
