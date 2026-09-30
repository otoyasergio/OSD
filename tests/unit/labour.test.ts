import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatLabourComparison } from "@/lib/services/labour";

describe("formatLabourComparison", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-09T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns null when startedAt is missing", () => {
    expect(formatLabourComparison(1.5, null, "2026-07-09T14:00:00.000Z")).toBeNull();
  });

  it("formats est and actual hours from startedAt to completedAt", () => {
    const result = formatLabourComparison(
      1.5,
      "2026-07-09T10:00:00.000Z",
      "2026-07-09T12:06:00.000Z"
    );
    expect(result).toEqual({
      label: "Est 1.5h · Actual 2.1h",
      overEstimate: true,
    });
  });

  it("uses now when completedAt is null", () => {
    const result = formatLabourComparison(2, "2026-07-09T10:00:00.000Z", null);
    expect(result).toEqual({
      label: "Est 2h · Actual 2h",
      overEstimate: false,
    });
  });

  it("marks overEstimate when actual exceeds estimate × 1.1", () => {
    const under = formatLabourComparison(
      2,
      "2026-07-09T10:00:00.000Z",
      "2026-07-09T12:12:00.000Z"
    );
    expect(under?.overEstimate).toBe(false);

    const over = formatLabourComparison(
      2,
      "2026-07-09T10:00:00.000Z",
      "2026-07-09T12:13:00.000Z"
    );
    expect(over?.overEstimate).toBe(true);
  });

  it("omits Est when estimatedHours is null", () => {
    const result = formatLabourComparison(
      null,
      "2026-07-09T10:00:00.000Z",
      "2026-07-09T11:00:00.000Z"
    );
    expect(result).toEqual({
      label: "Actual 1h",
      overEstimate: false,
    });
  });

  it("prefers segment actual ms when provided", () => {
    const result = formatLabourComparison(
      2,
      "2026-07-09T10:00:00.000Z",
      "2026-07-09T14:00:00.000Z",
      { actualMsFromSegments: 1.5 * 60 * 60 * 1000 }
    );
    expect(result).toEqual({
      label: "Est 2h · Actual 1.5h",
      overEstimate: false,
    });
  });
});
