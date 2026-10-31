import { describe, expect, it, vi } from "vitest";
import { TimelineEventType } from "@/lib/timeline/events";
import {
  buildWeeklyShopReport,
  renderWeeklyShopReport,
  runWeeklyShopReport,
  type WeeklyShopReportInput,
} from "@/lib/reports/weeklyShopReport";

const NOW = new Date("2026-10-31T00:00:00.000Z");

function emptyInput(
  overrides: Partial<WeeklyShopReportInput> = {}
): WeeklyShopReportInput {
  return {
    now: NOW,
    workOrders: [],
    jobs: [],
    inspectionCompletedAt: [],
    clock: [],
    jobTime: [],
    parts: [],
    timeline: [],
    ...overrides,
  };
}

describe("buildWeeklyShopReport", () => {
  it("renders an empty week without throwing", () => {
    const message = renderWeeklyShopReport(buildWeeklyShopReport(emptyInput()));
    expect(message.subject).toBe("Weekly shop report · Oct 24–30, 2026");
    expect(message.text).toContain("Bikes arrived: 0 (last week 0, 0)");
    expect(message.text).toContain("None.");
    expect(message.text).toContain("Parts still open: 0 needed, 0 ordered, 0 in stock.");
    expect(message.html).toContain("OTOMOTO TORONTO MOTO INC.");
  });

  it("compares the week to Friday 8 p.m. with the previous one and lists the bikes", () => {
    const report = buildWeeklyShopReport(
      emptyInput({
        workOrders: [
          {
            workOrderId: "wo-finished",
            workOrderNumber: "WO-1042",
            status: "completed",
            createdAt: "2026-10-26T14:00:00.000Z",
            completedAt: "2026-10-30T18:00:00.000Z",
            cancelledAt: null,
            collectedCents: 42000,
            year: 2019,
            make: "Honda",
            model: "CB500",
            customerName: "Sam <Rider>",
          },
          {
            workOrderId: "wo-last",
            workOrderNumber: "WO-1000",
            status: "completed",
            createdAt: "2026-10-19T14:00:00.000Z",
            completedAt: "2026-10-23T16:00:00.000Z",
            cancelledAt: null,
            collectedCents: 10000,
            year: 2018,
            make: "Yamaha",
            model: "MT-07",
            customerName: "Last Week",
          },
          {
            workOrderId: "wo-open",
            workOrderNumber: "WO-1100",
            status: "insurance",
            createdAt: "2026-10-28T15:00:00.000Z",
            completedAt: null,
            cancelledAt: null,
            collectedCents: 0,
            year: 2020,
            make: "Kawasaki",
            model: "Ninja",
            customerName: "Pat Insurance",
          },
          {
            workOrderId: "wo-cancelled",
            workOrderNumber: "WO-1101",
            status: "cancelled",
            createdAt: "2026-10-27T15:00:00.000Z",
            completedAt: null,
            // Cancelled Thursday, then edited Friday; the edit does not move it.
            cancelledAt: "2026-10-29T15:00:00.000Z",
            collectedCents: 0,
            year: 2015,
            make: "Suzuki",
            model: "SV650",
            customerName: "Quinn Cancel",
          },
          {
            workOrderId: "wo-boundary",
            workOrderNumber: "WO-1050",
            status: "cancelled",
            createdAt: "2026-10-20T15:00:00.000Z",
            completedAt: null,
            // Exactly Friday Oct 23 8:00 p.m.: belongs to last week, not this one.
            cancelledAt: "2026-10-24T00:00:00.000Z",
            collectedCents: 0,
            year: 2016,
            make: "Ducati",
            model: "Monster",
            customerName: "Bo Boundary",
          },
        ],
        jobs: [
          {
            workOrderId: "wo-finished",
            name: "Oil change",
            completedAt: "2026-10-30T17:00:00.000Z",
            approvedAt: "2026-10-27T15:00:00.000Z",
            declinedAt: null,
          },
        ],
        inspectionCompletedAt: ["2026-10-27T16:00:00.000Z"],
        clock: [
          {
            startedAt: "2026-10-30T23:00:00.000Z",
            endedAt: "2026-10-31T01:00:00.000Z",
          },
          {
            startedAt: "2026-10-19T14:00:00.000Z",
            endedAt: "2026-10-19T16:00:00.000Z",
          },
        ],
        jobTime: [
          {
            startedAt: "2026-10-30T22:00:00.000Z",
            endedAt: "2026-10-30T23:00:00.000Z",
          },
        ],
        parts: [{ status: "needed" }, { status: "ordered" }],
        timeline: [
          {
            workOrderId: "wo-open",
            eventType: TimelineEventType.WORK_ORDER_STATUS_CHANGED,
            description: "Board move: status changed to insurance",
            createdAt: "2026-10-30T17:00:00.000Z",
          },
          {
            workOrderId: "wo-open",
            eventType: TimelineEventType.INTAKE_PHOTO_UPLOADED,
            description: "Photo uploaded",
            createdAt: "2026-10-30T16:00:00.000Z",
          },
        ],
      })
    );

    const arrived = report.comparison.find((metric) => metric.label === "Bikes arrived");
    const completed = report.comparison.find(
      (metric) => metric.label === "Bikes completed"
    );
    const collected = report.comparison.find(
      (metric) => metric.label === "Collected on completed bikes"
    );
    const staff = report.comparison.find((metric) => metric.label === "Staff hours");
    const cancelledMetric = report.comparison.find(
      (metric) => metric.label === "Bikes cancelled"
    );
    expect(arrived).toMatchObject({ current: 3, previous: 2 });
    expect(cancelledMetric).toMatchObject({ current: 1, previous: 1 });
    expect(completed).toMatchObject({ current: 1, previous: 1 });
    expect(collected).toMatchObject({ current: 42000, previous: 10000 });
    expect(staff).toMatchObject({ current: 1, previous: 2 });

    expect(report.finished).toHaveLength(1);
    expect(report.finished[0]?.bikeLabel).toBe("2019 Honda CB500");
    expect(report.finished[0]?.jobs).toEqual(["Oil change"]);
    expect(report.finished[0]?.collectedCents).toBe(42000);
    expect(report.cancelled.map((bike) => bike.workOrderNumber)).toEqual(["WO-1101"]);
    expect(report.cancelled[0]?.daysInShop).toBe(2);
    expect(report.stillHere.map((group) => group.status)).toEqual(["insurance"]);
    expect(report.stillHere[0]?.bikes[0]?.notes).toEqual([
      "Board move: status changed to insurance",
    ]);
    expect(report.parts).toEqual({ needed: 1, ordered: 1, inStock: 0 });

    const message = renderWeeklyShopReport(report);
    expect(message.text).toContain("2019 Honda CB500 · WO-1042 · Sam <Rider>");
    expect(message.text).toContain("$420.00");
    expect(message.text).toContain("Jobs: Oil change");
    expect(message.html).toContain("Sam &lt;Rider&gt;");
    expect(message.html).not.toContain("Sam <Rider>");
    expect(message.text).toContain("2015 Suzuki SV650 · WO-1101 · Quinn Cancel");
    expect(message.text).not.toContain("Bo Boundary");
  });
});

describe("runWeeklyShopReport", () => {
  it("does not send twice for the same week key", async () => {
    const sent: string[] = [];
    const claimed = new Set<string>();
    const prepare = vi.fn(async () => ({
      dedupeKey: "TOR:2026-10-24",
      subject: "Weekly shop report · Oct 24–30, 2026",
      text: "report",
      html: "<p>report</p>",
    }));

    const once = () =>
      runWeeklyShopReport({
        prepare,
        claim: async (dedupeKey) => {
          if (claimed.has(dedupeKey)) return "duplicate";
          claimed.add(dedupeKey);
          return "claimed";
        },
        send: async (message) => {
          sent.push(message.subject);
          return { id: "gmail-1" };
        },
        markSent: async () => {},
        release: async () => {},
      });

    await expect(once()).resolves.toEqual({ ok: true, messageId: "gmail-1" });
    await expect(once()).resolves.toEqual({ ok: true, skipped: "already_sent" });
    expect(sent).toEqual(["Weekly shop report · Oct 24–30, 2026"]);
  });

  it("releases the claim when sending fails", async () => {
    const released: string[] = [];
    await expect(
      runWeeklyShopReport({
        prepare: async () => ({
          dedupeKey: "TOR:2026-10-24",
          subject: "Weekly shop report",
          text: "report",
          html: "<p>report</p>",
        }),
        claim: async () => "claimed",
        send: async () => {
          throw new Error("EMAIL_NOT_CONFIGURED");
        },
        markSent: async () => {},
        release: async (dedupeKey) => {
          released.push(dedupeKey);
        },
      })
    ).rejects.toThrow("EMAIL_NOT_CONFIGURED");
    expect(released).toEqual(["TOR:2026-10-24"]);
  });
});
