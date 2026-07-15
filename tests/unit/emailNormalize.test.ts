import { describe, expect, it } from "vitest";
import { normalizeEmailInput } from "@/lib/email/normalize";

describe("normalizeEmailInput", () => {
  it("removes whitespace and lowercases email addresses", () => {
    expect(normalizeEmailInput("  Sergio.Otoya @Example.COM ")).toBe(
      "sergio.otoya@example.com"
    );
  });

  it("handles an empty email", () => {
    expect(normalizeEmailInput(null)).toBe("");
  });
});
