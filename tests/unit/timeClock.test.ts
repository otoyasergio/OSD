import { describe, expect, it } from "vitest";
import {
  formatElapsedMs,
  punchDurationMs,
  formatHoursDecimal,
  allocatePunchMsByShopDay,
  summarizeWeek,
  buildTimesheetCsv,
  buildShiftMonthCalendar,
  shiftHoursLabel,
} from "@/lib/services/timeClockShared";
import {
  shopDateKey,
  toShopDatetimeLocalValue,
  getShopWeekRange,
  getShopMonthRange,
} from "@/lib/datetime/format";

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

describe("punchDurationMs", () => {
  it("returns closed punch duration", () => {
    const ms = punchDurationMs("2026-07-12T14:00:00.000Z", "2026-07-12T18:30:00.000Z");
    expect(ms).toBe(4.5 * 60 * 60 * 1000);
  });

  it("uses now for open punches", () => {
    const now = new Date("2026-07-12T16:00:00.000Z").getTime();
    const ms = punchDurationMs("2026-07-12T14:00:00.000Z", null, now);
    expect(ms).toBe(2 * 60 * 60 * 1000);
  });
});

describe("formatHoursDecimal", () => {
  it("formats milliseconds as decimal hours", () => {
    expect(formatHoursDecimal(4.5 * 60 * 60 * 1000)).toBe("4.50");
    expect(formatHoursDecimal(0)).toBe("0.00");
  });
});

describe("shopDateKey / datetime-local", () => {
  it("returns YYYY-MM-DD in America/Toronto", () => {
    // 02:30 UTC Jul 13 = 22:30 EDT Jul 12
    expect(shopDateKey("2026-07-13T02:30:00.000Z")).toBe("2026-07-12");
    expect(shopDateKey("2026-07-12T18:30:00.000Z")).toBe("2026-07-12");
  });

  it("formats datetime-local wall time in Toronto", () => {
    expect(toShopDatetimeLocalValue("2026-07-12T18:30:00.000Z")).toBe("2026-07-12T14:30");
  });
});

describe("getShopWeekRange", () => {
  it("returns Mon–Sun week containing a Toronto date (EDT)", () => {
    // Sunday Jul 12, 2026 afternoon Toronto → week Mon Jul 6 – Sun Jul 12
    const range = getShopWeekRange("2026-07-12T18:00:00.000Z");
    expect(range.startDateKey).toBe("2026-07-06");
    expect(range.endDateKey).toBe("2026-07-12");
    expect(range.dateKeys).toEqual([
      "2026-07-06",
      "2026-07-07",
      "2026-07-08",
      "2026-07-09",
      "2026-07-10",
      "2026-07-11",
      "2026-07-12",
    ]);
    expect(shopDateKey(range.startUtc)).toBe("2026-07-06");
    expect(shopDateKey(new Date(range.endUtc.getTime() - 1))).toBe("2026-07-12");
  });
});

describe("allocatePunchMsByShopDay", () => {
  it("splits a punch that crosses midnight Toronto", () => {
    // 23:00 → 01:00 Toronto EDT = 03:00 → 05:00 UTC Jul 13
    const byDay = allocatePunchMsByShopDay(
      "2026-07-13T03:00:00.000Z",
      "2026-07-13T05:00:00.000Z"
    );
    expect(byDay.get("2026-07-12")).toBe(60 * 60 * 1000);
    expect(byDay.get("2026-07-13")).toBe(60 * 60 * 1000);
  });

  it("keeps a same-day punch on one date key", () => {
    const byDay = allocatePunchMsByShopDay(
      "2026-07-12T14:00:00.000Z",
      "2026-07-12T18:00:00.000Z"
    );
    expect([...byDay.entries()]).toEqual([["2026-07-12", 4 * 60 * 60 * 1000]]);
  });
});

describe("summarizeWeek", () => {
  it("totals hours per user and marks open punches", () => {
    const now = new Date("2026-07-12T20:00:00.000Z").getTime();
    const range = getShopWeekRange("2026-07-12T18:00:00.000Z");
    const summaries = summarizeWeek(
      [
        {
          entry_id: "e1",
          user_id: "u1",
          first_name: "Ada",
          last_name: "Tech",
          clock_in_at: "2026-07-12T14:00:00.000Z",
          clock_out_at: "2026-07-12T18:00:00.000Z",
          notes: null,
        },
        {
          entry_id: "e2",
          user_id: "u1",
          first_name: "Ada",
          last_name: "Tech",
          clock_in_at: "2026-07-12T19:00:00.000Z",
          clock_out_at: null,
          notes: null,
        },
        {
          entry_id: "e3",
          user_id: "u2",
          first_name: "Bob",
          last_name: "Wrench",
          clock_in_at: "2026-07-10T14:00:00.000Z",
          clock_out_at: "2026-07-10T22:00:00.000Z",
          notes: null,
        },
      ],
      range,
      now
    );

    expect(summaries).toHaveLength(2);
    const ada = summaries.find((s) => s.user_id === "u1")!;
    expect(ada.display_name).toBe("Ada Tech");
    expect(ada.open_entry_ids).toEqual(["e2"]);
    // 4h closed + 1h open (19:00–20:00 UTC)
    expect(ada.total_ms).toBe(5 * 60 * 60 * 1000);
    expect(formatHoursDecimal(ada.total_ms)).toBe("5.00");

    const bob = summaries.find((s) => s.user_id === "u2")!;
    expect(bob.total_ms).toBe(8 * 60 * 60 * 1000);
    expect(bob.open_entry_ids).toEqual([]);
  });
});

describe("buildTimesheetCsv", () => {
  it("exports payroll-friendly CSV rows", () => {
    const csv = buildTimesheetCsv(
      [
        {
          entry_id: "e1",
          user_id: "u1",
          first_name: "Ada",
          last_name: "Tech",
          clock_in_at: "2026-07-12T14:00:00.000Z",
          clock_out_at: "2026-07-12T18:30:00.000Z",
          notes: 'Shift "A"',
        },
      ],
      new Date("2026-07-12T20:00:00.000Z").getTime()
    );

    const lines = csv.trim().split("\n");
    expect(lines[0]).toBe("employee,user_id,date,clock_in,clock_out,hours,notes,status");
    expect(lines[1]).toContain("Ada Tech");
    expect(lines[1]).toContain("4.50");
    expect(lines[1]).toContain("closed");
    expect(lines[1]).toContain('"Shift ""A"""');
  });
});

describe("getShopMonthRange", () => {
  it("returns calendar month in America/Toronto with exclusive end", () => {
    // Afternoon Jul 12 Toronto EDT
    const range = getShopMonthRange("2026-07-12T18:00:00.000Z");
    expect(range.monthKey).toBe("2026-07");
    expect(range.startDateKey).toBe("2026-07-01");
    expect(range.endDateKey).toBe("2026-07-31");
    expect(range.dateKeys).toHaveLength(31);
    expect(range.dateKeys[0]).toBe("2026-07-01");
    expect(range.dateKeys[30]).toBe("2026-07-31");
    expect(shopDateKey(range.startUtc)).toBe("2026-07-01");
    expect(shopDateKey(new Date(range.endUtc.getTime() - 1))).toBe("2026-07-31");
  });

  it("accepts YYYY-MM month keys", () => {
    const range = getShopMonthRange("2026-02");
    expect(range.monthKey).toBe("2026-02");
    expect(range.startDateKey).toBe("2026-02-01");
    expect(range.endDateKey).toBe("2026-02-28");
    expect(range.dateKeys).toHaveLength(28);
  });
});

describe("shiftHoursLabel", () => {
  it("formats short hour labels for calendar cells", () => {
    expect(shiftHoursLabel(0)).toBe("");
    expect(shiftHoursLabel(45 * 1000)).toBe("1m");
    expect(shiftHoursLabel(30 * 60 * 1000)).toBe("0.5h");
    expect(shiftHoursLabel(4 * 60 * 60 * 1000)).toBe("4h");
    expect(shiftHoursLabel(8.5 * 60 * 60 * 1000)).toBe("8.5h");
  });
});

describe("buildShiftMonthCalendar", () => {
  it("builds a Mon–Sun grid with hours and open markers", () => {
    const now = new Date("2026-07-12T20:00:00.000Z").getTime();
    const range = getShopMonthRange("2026-07");
    const calendar = buildShiftMonthCalendar(
      [
        {
          entry_id: "e1",
          user_id: "u1",
          clock_in_at: "2026-07-12T14:00:00.000Z",
          clock_out_at: "2026-07-12T18:00:00.000Z",
        },
        {
          entry_id: "e2",
          user_id: "u1",
          clock_in_at: "2026-07-12T19:00:00.000Z",
          clock_out_at: null,
        },
        {
          entry_id: "e3",
          user_id: "u1",
          clock_in_at: "2026-07-06T14:00:00.000Z",
          clock_out_at: "2026-07-06T22:00:00.000Z",
        },
      ],
      range,
      now
    );

    expect(calendar.monthKey).toBe("2026-07");
    expect(calendar.prevMonthKey).toBe("2026-06");
    expect(calendar.nextMonthKey).toBe("2026-08");
    expect(calendar.label).toMatch(/July 2026/i);
    // Jul 1 2026 is Wednesday → pad Mon Jun 29, Tue Jun 30
    expect(calendar.days[0].dateKey).toBe("2026-06-29");
    expect(calendar.days[0].inMonth).toBe(false);
    expect(calendar.days.length % 7).toBe(0);

    const jul6 = calendar.days.find((d) => d.dateKey === "2026-07-06")!;
    expect(jul6.inMonth).toBe(true);
    expect(jul6.ms).toBe(8 * 60 * 60 * 1000);
    expect(jul6.open).toBe(false);
    expect(jul6.entryCount).toBe(1);

    const jul12 = calendar.days.find((d) => d.dateKey === "2026-07-12")!;
    // 4h closed + 1h open (19:00–20:00 UTC)
    expect(jul12.ms).toBe(5 * 60 * 60 * 1000);
    expect(jul12.open).toBe(true);
    expect(jul12.entryCount).toBe(2);

    expect(calendar.total_ms).toBe(13 * 60 * 60 * 1000);
  });

  it("allocates overnight punches that start before the month", () => {
    const range = getShopMonthRange("2026-08");
    const calendar = buildShiftMonthCalendar(
      [
        {
          entry_id: "overnight",
          user_id: "u1",
          // Jul 31 23:00 → Aug 1 01:00 Toronto EDT
          clock_in_at: "2026-08-01T03:00:00.000Z",
          clock_out_at: "2026-08-01T05:00:00.000Z",
        },
      ],
      range
    );

    const aug1 = calendar.days.find((d) => d.dateKey === "2026-08-01")!;
    expect(aug1.ms).toBe(60 * 60 * 1000);
    expect(aug1.entryCount).toBe(1);
    expect(calendar.total_ms).toBe(60 * 60 * 1000);
  });
});
