import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("root layout", () => {
  it("records page views and real-user timing", () => {
    const layout = readFileSync(join(process.cwd(), "app", "layout.tsx"), "utf8");
    const telemetry = readFileSync(
      join(process.cwd(), "components", "analytics", "AppTelemetry.tsx"),
      "utf8"
    );
    expect(layout).toContain("<AppTelemetry");
    expect(telemetry).toContain("@vercel/analytics/next");
    expect(telemetry).toContain("<Analytics");
    expect(telemetry).toContain("@vercel/speed-insights/next");
    expect(telemetry).toContain("<SpeedInsights");
    expect(telemetry).toContain("shouldCollectPublicMetrics");
    expect(telemetry).toContain("beforeSend=");
  });
});
