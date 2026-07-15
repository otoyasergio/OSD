import { describe, expect, it } from "vitest";
import { canUnsendMessage } from "@/lib/messenger/unsendWindow";

describe("canUnsendMessage", () => {
  it("allows within 15 minutes", () => {
    const now = new Date("2026-07-13T12:10:00Z");
    expect(canUnsendMessage("2026-07-13T12:00:00Z", now)).toBe(true);
  });
  it("blocks after 15 minutes", () => {
    const now = new Date("2026-07-13T12:16:00Z");
    expect(canUnsendMessage("2026-07-13T12:00:00Z", now)).toBe(false);
  });
});
