import { describe, expect, it } from "vitest";
import { shouldCollectPublicMetrics } from "@/lib/passport/publicRoute";

describe("passport public route telemetry", () => {
  it("excludes secret-bearing passport URLs from analytics and speed insights", () => {
    expect(
      shouldCollectPublicMetrics("https://service.torontomoto.com/p/secret-token")
    ).toBe(false);
    expect(shouldCollectPublicMetrics("/p/secret-token?print=1")).toBe(false);
    expect(shouldCollectPublicMetrics("/motorcycles/123/passport")).toBe(true);
  });
});
