import { describe, expect, it } from "vitest";
import {
  formatDate,
  formatDateTime,
  formatTime,
  nextShopBusinessCompletionValue,
  parseShopLocalDateTimeInput,
} from "@/lib/datetime/format";

describe("formatDateTime / formatDate / formatTime", () => {
  it("formats a UTC instant in America/Toronto (EDT)", () => {
    // 18:30 UTC = 14:30 Eastern Daylight Time
    const iso = "2026-07-12T18:30:00.000Z";
    expect(formatDateTime(iso)).toMatch(/Jul 12, 2026/);
    expect(formatDateTime(iso)).toMatch(/2:30/);
    expect(formatDate(iso)).toBe("Jul 12, 2026");
    expect(formatTime(iso)).toMatch(/2:30/);
  });

  it("formats a UTC instant in America/Toronto (EST)", () => {
    // 19:30 UTC = 14:30 Eastern Standard Time
    const iso = "2026-01-12T19:30:00.000Z";
    expect(formatDateTime(iso)).toMatch(/Jan 12, 2026/);
    expect(formatDateTime(iso)).toMatch(/2:30/);
  });

  it("returns empty for null/invalid", () => {
    expect(formatDateTime(null)).toBe("");
    expect(formatDateTime("not-a-date")).toBe("");
    expect(formatDate(undefined)).toBe("");
    expect(formatTime("")).toBe("");
  });
});

describe("parseShopLocalDateTimeInput", () => {
  it("treats datetime-local wall time as America/Toronto (EDT)", () => {
    const date = parseShopLocalDateTimeInput("2026-07-12T14:30");
    expect(date).not.toBeNull();
    // EDT is UTC-4 → 14:30 Toronto = 18:30 UTC
    expect(date!.toISOString()).toBe("2026-07-12T18:30:00.000Z");
  });

  it("treats datetime-local wall time as America/Toronto (EST)", () => {
    const date = parseShopLocalDateTimeInput("2026-01-12T14:30");
    expect(date).not.toBeNull();
    // EST is UTC-5 → 14:30 Toronto = 19:30 UTC
    expect(date!.toISOString()).toBe("2026-01-12T19:30:00.000Z");
  });

  it("returns null for empty/invalid", () => {
    expect(parseShopLocalDateTimeInput("")).toBeNull();
    expect(parseShopLocalDateTimeInput("nope")).toBeNull();
  });
});

describe("nextShopBusinessCompletionValue", () => {
  it("defaults a weekday intake to the next weekday at 7 p.m.", () => {
    expect(nextShopBusinessCompletionValue("2026-07-15T16:00:00.000Z")).toBe(
      "2026-07-16T19:00"
    );
  });

  it("uses the Saturday 4 p.m. close after Friday", () => {
    expect(nextShopBusinessCompletionValue("2026-07-17T16:00:00.000Z")).toBe(
      "2026-07-18T16:00"
    );
  });

  it("skips Sunday after a Saturday intake", () => {
    expect(nextShopBusinessCompletionValue("2026-07-18T16:00:00.000Z")).toBe(
      "2026-07-20T19:00"
    );
  });

  it("skips configured closure dates", () => {
    expect(
      nextShopBusinessCompletionValue("2026-07-15T16:00:00.000Z", [
        "2026-07-16",
        "2026-07-17",
        "2026-07-18",
      ])
    ).toBe("2026-07-20T19:00");
  });
});
