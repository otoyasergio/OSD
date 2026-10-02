import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("root layout", () => {
  it("records page views and real-user timing", () => {
    const source = readFileSync(join(process.cwd(), "app", "layout.tsx"), "utf8");
    expect(source).toContain('import { Analytics } from "@vercel/analytics/next"');
    expect(source).toContain("<Analytics");
    expect(source).toContain("@vercel/speed-insights/next");
    expect(source).toContain("<SpeedInsights");
  });
});
