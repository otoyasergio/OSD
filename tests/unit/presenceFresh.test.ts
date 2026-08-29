import { describe, expect, it } from "vitest";
import { isPresenceFresh } from "@/lib/twilio/presenceFresh";

const NOW = new Date("2026-08-25T12:00:00.000Z");

describe("isPresenceFresh", () => {
  it("treats a heartbeat within 90 seconds as registered", () => {
    expect(isPresenceFresh("2026-08-25T11:59:00.000Z", NOW)).toBe(true);
    expect(isPresenceFresh("2026-08-25T11:58:29.000Z", NOW)).toBe(false);
    expect(isPresenceFresh(null, NOW)).toBe(false);
  });
});
