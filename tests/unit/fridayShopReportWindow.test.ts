import { describe, expect, it } from "vitest";
import { getFridayShopReportWindow, isFridayShopReportHour } from "@/lib/datetime/format";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

describe("isFridayShopReportHour", () => {
  it("matches Friday 8:00 p.m. Toronto in summer and winter", () => {
    // Friday Oct 30, 2026 8:00 p.m. EDT = Saturday 00:00 UTC
    expect(isFridayShopReportHour(new Date("2026-10-31T00:00:00.000Z"))).toBe(true);
    expect(isFridayShopReportHour(new Date("2026-10-31T00:59:59.000Z"))).toBe(true);
    // Friday Jan 15, 2027 8:00 p.m. EST = Saturday 01:00 UTC
    expect(isFridayShopReportHour(new Date("2027-01-16T01:00:00.000Z"))).toBe(true);
  });

  it("rejects Friday 7:00 p.m. and Saturday", () => {
    // Friday Oct 30, 2026 7:00 p.m. EDT
    expect(isFridayShopReportHour(new Date("2026-10-30T23:00:00.000Z"))).toBe(false);
    // Saturday Oct 31, 2026 12:00 p.m. EDT
    expect(isFridayShopReportHour(new Date("2026-10-31T16:00:00.000Z"))).toBe(false);
    // The other UTC slot is 9:00 p.m. Friday in summer and 7:00 p.m. Friday in winter.
    expect(isFridayShopReportHour(new Date("2026-10-31T01:00:00.000Z"))).toBe(false);
    expect(isFridayShopReportHour(new Date("2027-01-16T00:00:00.000Z"))).toBe(false);
  });
});

describe("getFridayShopReportWindow", () => {
  it("runs Friday 8:00 p.m. to Friday 8:00 p.m. with the previous seven days beside it", () => {
    const summer = getFridayShopReportWindow("2026-10-31T00:00:00.000Z");
    expect(summer.current.startDateKey).toBe("2026-10-24");
    expect(summer.current.endDateKey).toBe("2026-10-30");
    // Friday Oct 23 8:00 p.m. EDT
    expect(summer.current.startUtc.toISOString()).toBe("2026-10-24T00:00:00.000Z");
    expect(summer.current.endUtc.toISOString()).toBe("2026-10-31T00:00:00.000Z");
    expect(summer.previous.startDateKey).toBe("2026-10-17");
    expect(summer.previous.endDateKey).toBe("2026-10-23");
    expect(summer.previous.endUtc.toISOString()).toBe("2026-10-24T00:00:00.000Z");
    // Adjacent spans meet at one instant, so no hour is counted twice or missed.
    expect(summer.previous.endUtc.getTime()).toBe(summer.current.startUtc.getTime());
    expect(summer.current.endUtc.getTime() - summer.current.startUtc.getTime()).toBe(
      WEEK_MS
    );

    const winter = getFridayShopReportWindow("2027-01-16T01:00:00.000Z");
    expect(winter.current.startDateKey).toBe("2027-01-09");
    expect(winter.current.endDateKey).toBe("2027-01-15");
    expect(winter.current.endUtc.toISOString()).toBe("2027-01-16T01:00:00.000Z");
    expect(winter.previous.startDateKey).toBe("2027-01-02");
    expect(winter.previous.endDateKey).toBe("2027-01-08");
    expect(winter.previous.endUtc.getTime()).toBe(winter.current.startUtc.getTime());
    expect(winter.current.endUtc.getTime() - winter.previous.endUtc.getTime()).toBe(
      WEEK_MS
    );
  });

  it("keeps the span on the Friday wall clock across the fall DST change", () => {
    // Friday Nov 6, 2026 8:00 p.m. EST = Saturday 01:00 UTC; DST ended Nov 1.
    const window = getFridayShopReportWindow("2026-11-07T01:00:00.000Z");
    expect(window.current.startUtc.toISOString()).toBe("2026-10-31T00:00:00.000Z");
    expect(window.current.endUtc.toISOString()).toBe("2026-11-07T01:00:00.000Z");
    expect(window.current.endUtc.getTime() - window.current.startUtc.getTime()).toBe(
      WEEK_MS + 60 * 60 * 1000
    );
  });
});
