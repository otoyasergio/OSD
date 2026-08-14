import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("PhotoActionCard RSC safety", () => {
  it("does not pass event handlers to Link", () => {
    const source = readFileSync(
      join(process.cwd(), "components/ui/PhotoActionCard.tsx"),
      "utf8"
    );
    expect(source).not.toMatch(/\bon[A-Z][A-Za-z]+\s*=/);
  });
});
