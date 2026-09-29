import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("authenticated app rendering", () => {
  it("forces request-time rendering before reading the staff session", () => {
    const source = readFileSync(
      join(process.cwd(), "app", "(app)", "layout.tsx"),
      "utf8"
    );
    expect(source).toContain('export const dynamic = "force-dynamic"');
  });
});
