import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("Track Day tokens", () => {
  it("defines monochrome chrome and ink signals in globals.css", () => {
    const css = readFileSync(join(process.cwd(), "app/globals.css"), "utf8");
    expect(css).toContain("--chrome: #0b1220");
    expect(css).toContain("--accent: #0a0a0a");
    expect(css).toContain("--background: #fafafa");
    expect(css).toContain("--signal-teal:");
    expect(css).toContain("--status-waiting: #71717a");
  });
});
