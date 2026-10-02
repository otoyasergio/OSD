import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("root layout", () => {
  it("records real-user timing with Speed Insights", () => {
    const source = readFileSync(join(process.cwd(), "app", "layout.tsx"), "utf8");
    expect(source).toContain("@vercel/speed-insights/next");
    expect(source).toContain("<SpeedInsights");
  });
});
