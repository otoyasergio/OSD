import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("guard-prod-deploy", () => {
  const source = readFileSync(
    join(process.cwd(), "scripts/guard-prod-deploy.mjs"),
    "utf8"
  );

  it("requires the main branch", () => {
    expect(source).toContain('branch !== "main"');
    expect(source).toContain("origin/main");
  });

  it("blocks dirty trees and mismatched remote tips", () => {
    expect(source).toContain("git status --porcelain");
    expect(source).toContain("does not match origin/main");
  });
});
