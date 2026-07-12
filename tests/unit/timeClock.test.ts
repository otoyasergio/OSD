import { describe, expect, it } from "vitest";
import { formatElapsedMs } from "@/lib/services/timeClock";

describe("formatElapsedMs", () => {
  it("formats under an hour as m:ss", () => {
    const started = new Date("2026-07-12T12:00:00.000Z").toISOString();
    const now = new Date("2026-07-12T12:05:07.000Z").getTime();
    expect(formatElapsedMs(started, now)).toBe("5:07");
  });

  it("formats hours as h:mm:ss", () => {
    const started = new Date("2026-07-12T10:00:00.000Z").toISOString();
    const now = new Date("2026-07-12T12:03:09.000Z").getTime();
    expect(formatElapsedMs(started, now)).toBe("2:03:09");
  });
});
