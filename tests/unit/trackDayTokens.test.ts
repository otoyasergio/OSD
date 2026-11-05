import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("Track Day tokens", () => {
  it("defines Track Day chrome, orange, and teal signals in globals.css", () => {
    const css = readFileSync(join(process.cwd(), "app/globals.css"), "utf8");
    expect(css).toContain("--chrome: #0b1220");
    expect(css).toContain("--accent: #f97316");
    expect(css).toContain("--accent-ink: #c2410c");
    expect(css).toContain("--background: #fafafa");
    expect(css).toContain("--signal-teal: #0f766e");
    expect(css).toContain("--status-waiting: #0e7490");
    expect(css).toContain("--status-danger: #b91c1c");
    expect(css).toContain("--status-success: #047857");
  });
});
