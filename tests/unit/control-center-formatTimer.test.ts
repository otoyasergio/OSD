import { describe, expect, it } from "vitest";
import {
  calculateAverageDaysInShop,
  formatElapsedTimer,
  timeInShopTone,
} from "@/lib/control-center/formatTimer";

describe("formatElapsedTimer", () => {
  it("formats under one hour as M:SS", () => {
    expect(formatElapsedTimer(65_000)).toBe("1:05");
  });

  it("formats up to 24 hours as H:MM:SS", () => {
    expect(formatElapsedTimer(5 * 3600 * 1000 + 70_000)).toBe("5:01:10");
    expect(formatElapsedTimer(24 * 3600 * 1000 - 1000)).toBe("23:59:59");
  });

  it("counts whole days from 24 hours on", () => {
    expect(formatElapsedTimer(24 * 3600 * 1000)).toBe("1 day");
    expect(formatElapsedTimer(25 * 3600 * 1000)).toBe("1 day");
    expect(formatElapsedTimer(52 * 3600 * 1000 + 70_000)).toBe("2 days");
  });

  it("clamps negative to zero", () => {
    expect(formatElapsedTimer(-1000)).toBe("0:00");
  });
});

describe("timeInShopTone", () => {
  it("is fresh under 24h", () => {
    expect(timeInShopTone(23 * 3600 * 1000)).toBe("fresh");
  });

  it("is aging from 24h to 48h", () => {
    expect(timeInShopTone(25 * 3600 * 1000)).toBe("aging");
  });

  it("is stale at 48h+", () => {
    expect(timeInShopTone(48 * 3600 * 1000)).toBe("stale");
  });
});

describe("calculateAverageDaysInShop", () => {
  const now = new Date("2026-10-30T12:00:00.000Z");

  it("excludes completed, in_storage, and cancelled bikes from the average", () => {
    const avg = calculateAverageDaysInShop(
      [
        { status: "in_progress", date_created: "2026-10-28T12:00:00.000Z" }, // 2 days
        { status: "waiting_for_parts", date_created: "2026-10-26T12:00:00.000Z" }, // 4 days
        { status: "in_storage", date_created: "2026-08-01T12:00:00.000Z" }, // 90 days (ignored)
        { status: "completed", date_created: "2026-07-01T12:00:00.000Z" }, // 121 days (ignored)
        { status: "cancelled", date_created: "2026-07-01T12:00:00.000Z" }, // ignored
      ],
      now
    );
    expect(avg).toBe(3);
  });

  it("returns null when only storage or completed bikes exist", () => {
    const avg = calculateAverageDaysInShop(
      [
        { status: "in_storage", date_created: "2026-08-01T12:00:00.000Z" },
        { status: "completed", date_created: "2026-07-01T12:00:00.000Z" },
      ],
      now
    );
    expect(avg).toBeNull();
  });
});
