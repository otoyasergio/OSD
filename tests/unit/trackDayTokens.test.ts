import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("Track Day tokens", () => {
  it("defines Track Day chrome and signals in globals.css", () => {
    const css = readFileSync(join(process.cwd(), "app/globals.css"), "utf8");
    expect(css).toContain("--chrome: #0b1220");
    expect(css).toContain("--accent: #f97316");
    expect(css).toContain("--signal-teal:");
    expect(css).toContain("--status-waiting: #0891b2");
  });
});
