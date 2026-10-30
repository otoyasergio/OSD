import { describe, expect, it } from "vitest";
import { formatElapsedTimer, timeInShopTone } from "@/lib/control-center/formatTimer";

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
