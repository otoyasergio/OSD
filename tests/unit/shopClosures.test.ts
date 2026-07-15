import { describe, expect, it } from "vitest";
import { shopClosureSchema } from "@/lib/validation/schemas";

describe("shopClosureSchema", () => {
  it("accepts a calendar date and trims an optional reason", () => {
    expect(
      shopClosureSchema.parse({
        closure_date: "2026-12-25",
        reason: "  Christmas Day  ",
      })
    ).toEqual({ closure_date: "2026-12-25", reason: "Christmas Day" });
  });

  it("rejects impossible dates and long reasons", () => {
    expect(
      shopClosureSchema.safeParse({ closure_date: "2026-02-30", reason: "" }).success
    ).toBe(false);
    expect(
      shopClosureSchema.safeParse({
        closure_date: "2026-12-25",
        reason: "x".repeat(121),
      }).success
    ).toBe(false);
  });
});
