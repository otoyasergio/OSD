import {
  getFridayShopReportWindow,
  type FridayShopReportSpan,
} from "@/lib/datetime/format";
import {
  efficiencyPercent,
  roundTenth,
  sumPunchHours,
  type PunchInput,
} from "@/lib/reports/shopMetrics";
import { WORK_ORDER_STATUS_LABELS } from "@/lib/status/labels";
import { TimelineEventType } from "@/lib/timeline/events";
import type { WorkOrderStatus } from "@/lib/database/types";

export const WEEKLY_SHOP_REPORT_TEMPLATE = "weekly_shop_report";
export const WEEKLY_SHOP_REPORT_TO = "info@torontomoto.com";

const DAY_MS = 24 * 60 * 60 * 1000;
const TIMELINE_NOTES_PER_BIKE = 6;
const TIMELINE_NOTE_MAX = 180;

/** Timeline event types worth repeating under a still-here bike. */
export const WEEKLY_REPORT_NOTE_EVENTS = [
  TimelineEventType.WORK_ORDER_STATUS_CHANGED,
  TimelineEventType.JOB_CREATED,
  TimelineEventType.JOB_STATUS_CHANGED,
  TimelineEventType.CUSTOMER_APPROVAL_RECORDED,
  TimelineEventType.CUSTOMER_DECLINE_RECORDED,
  TimelineEventType.INSPECTION_COMPLETED,
  TimelineEventType.QUALITY_CHECK_COMPLETED,
  TimelineEventType.SAFETY_CHECK_PASSED,
  TimelineEventType.SAFETY_CHECK_FAILED,
  TimelineEventType.READY_FOR_PICKUP,
  TimelineEventType.WORK_ORDER_COMPLETED,
  TimelineEventType.WORK_ORDER_CANCELLED,
  TimelineEventType.WORK_ORDER_PLACED_ON_HOLD,
  TimelineEventType.PART_STATUS_CHANGED,
] as const;

const NOTEWORTHY_EVENTS = new Set<string>(WEEKLY_REPORT_NOTE_EVENTS);

const STILL_HERE_STATUS_ORDER: WorkOrderStatus[] = [
  "waiting_for_customer_approval",
  "waiting_for_parts",
  "in_progress",
  "ready_for_technician",
  "inspection_in_progress",
  "quality_check",
  "safety_check",
  "ready_for_pickup",
  "in_storage",
  "insurance",
  "on_hold",
  "open",
  "draft",
];

export type WeeklyWorkOrderInput = {
  workOrderId: string;
  workOrderNumber: string | null;
  status: string;
  createdAt: string;
  completedAt: string | null;
  /** Latest cancellation time from the timeline; null when never cancelled. */
  cancelledAt: string | null;
  collectedCents: number;
  year: number | null;
  make: string | null;
  model: string | null;
  customerName: string | null;
};

export type WeeklyJobInput = {
  workOrderId: string;
  name: string;
  completedAt: string | null;
  approvedAt: string | null;
  declinedAt: string | null;
};

export type WeeklyTimelineInput = {
  workOrderId: string;
  eventType: string;
  description: string;
  createdAt: string;
};

export type WeeklyShopReportInput = {
  now: Date;
  workOrders: WeeklyWorkOrderInput[];
  jobs: WeeklyJobInput[];
  inspectionCompletedAt: string[];
  clock: PunchInput[];
  jobTime: PunchInput[];
  parts: Array<{ status: string }>;
  timeline: WeeklyTimelineInput[];
};

export type WeeklyMetricFormat = "count" | "money" | "hours" | "percent";

export type WeeklyMetric = {
  label: string;
  current: number | null;
  previous: number | null;
  format: WeeklyMetricFormat;
};

export type WeeklyBikeLine = {
  workOrderId: string;
  workOrderNumber: string;
  bikeLabel: string;
  customerName: string;
  status: string;
  statusLabel: string;
  daysInShop: number;
  collectedCents: number | null;
  jobs: string[];
  notes: string[];
  cancelledAt: string | null;
};

export type WeeklyStatusGroup = {
  status: string;
  label: string;
  count: number;
  bikes: WeeklyBikeLine[];
};

export type WeeklyShopReport = {
  current: FridayShopReportSpan;
  previous: FridayShopReportSpan;
  comparison: WeeklyMetric[];
  parts: { needed: number; ordered: number; inStock: number };
  finished: WeeklyBikeLine[];
  arrived: WeeklyBikeLine[];
  cancelled: WeeklyBikeLine[];
  stillHere: WeeklyStatusGroup[];
};

export type WeeklyShopReportMessage = {
  subject: string;
  text: string;
  html: string;
};

function inSpan(iso: string | null | undefined, span: FridayShopReportSpan): boolean {
  if (!iso) return false;
  const time = new Date(iso).getTime();
  if (Number.isNaN(time)) return false;
  return time > span.startUtc.getTime() && time <= span.endUtc.getTime();
}

function spanHours(punches: PunchInput[], span: FridayShopReportSpan, now: Date): number {
  return sumPunchHours(punches, { now, from: span.startUtc, to: span.endUtc });
}

function statusLabel(status: string): string {
  if (status in WORK_ORDER_STATUS_LABELS) {
    return WORK_ORDER_STATUS_LABELS[status as WorkOrderStatus];
  }
  return status;
}

function bikeLabel(row: WeeklyWorkOrderInput): string {
  const parts = [row.year, row.make, row.model].filter(
    (part) => part != null && String(part).trim() !== ""
  );
  return parts.length > 0 ? parts.join(" ") : "Unknown bike";
}

function daysBetween(startIso: string, end: Date): number {
  const start = new Date(startIso).getTime();
  if (Number.isNaN(start)) return 0;
  return roundTenth(Math.max(0, end.getTime() - start) / DAY_MS);
}

function bikeLine(
  row: WeeklyWorkOrderInput,
  end: Date,
  extras: Partial<
    Pick<WeeklyBikeLine, "collectedCents" | "jobs" | "notes" | "cancelledAt">
  >
): WeeklyBikeLine {
  return {
    workOrderId: row.workOrderId,
    workOrderNumber: row.workOrderNumber?.trim() || "Unnumbered",
    bikeLabel: bikeLabel(row),
    customerName: row.customerName?.trim() || "No customer",
    status: row.status,
    statusLabel: statusLabel(row.status),
    daysInShop: daysBetween(row.createdAt, end),
    collectedCents: extras.collectedCents ?? null,
    jobs: extras.jobs ?? [],
    notes: extras.notes ?? [],
    cancelledAt: extras.cancelledAt ?? null,
  };
}

function countInSpan(values: Array<string | null>, span: FridayShopReportSpan): number {
  return values.filter((value) => inSpan(value, span)).length;
}

function notesFor(
  workOrderId: string,
  timeline: WeeklyTimelineInput[],
  span: FridayShopReportSpan
): string[] {
  const matches = timeline
    .filter(
      (event) =>
        event.workOrderId === workOrderId &&
        NOTEWORTHY_EVENTS.has(event.eventType) &&
        inSpan(event.createdAt, span) &&
        event.description.trim()
    )
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return matches.slice(-TIMELINE_NOTES_PER_BIKE).map((event) => {
    const text = event.description.trim().replace(/\s+/g, " ");
    return text.length > TIMELINE_NOTE_MAX
      ? `${text.slice(0, TIMELINE_NOTE_MAX - 1)}…`
      : text;
  });
}

function jobsCompletedInSpan(
  workOrderId: string,
  jobs: WeeklyJobInput[],
  span: FridayShopReportSpan
): string[] {
  return jobs
    .filter((job) => job.workOrderId === workOrderId && inSpan(job.completedAt, span))
    .map((job) => job.name.trim())
    .filter(Boolean);
}

export function weeklyReportDedupeKey(
  locationCode: string,
  span: FridayShopReportSpan
): string {
  return `${locationCode}:${span.startDateKey}`;
}

export function buildWeeklyShopReport(input: WeeklyShopReportInput): WeeklyShopReport {
  const { current, previous } = getFridayShopReportWindow(input.now);
  const workOrders = dedupeWorkOrders(input.workOrders);

  const arrived = (span: FridayShopReportSpan) =>
    workOrders.filter((row) => inSpan(row.createdAt, span));
  const finished = (span: FridayShopReportSpan) =>
    workOrders.filter(
      (row) => row.status === "completed" && inSpan(row.completedAt, span)
    );
  const cancelled = (span: FridayShopReportSpan) =>
    workOrders.filter(
      (row) => row.status === "cancelled" && inSpan(row.cancelledAt, span)
    );

  const revenue = (span: FridayShopReportSpan) =>
    finished(span).reduce((sum, row) => sum + Math.max(0, row.collectedCents || 0), 0);

  const techHours = {
    current: spanHours(input.clock, current, input.now),
    previous: spanHours(input.clock, previous, input.now),
  };
  const jobHours = {
    current: spanHours(input.jobTime, current, input.now),
    previous: spanHours(input.jobTime, previous, input.now),
  };

  const comparison: WeeklyMetric[] = [
    {
      label: "Bikes arrived",
      current: arrived(current).length,
      previous: arrived(previous).length,
      format: "count",
    },
    {
      label: "Bikes completed",
      current: finished(current).length,
      previous: finished(previous).length,
      format: "count",
    },
    {
      label: "Bikes cancelled",
      current: cancelled(current).length,
      previous: cancelled(previous).length,
      format: "count",
    },
    {
      label: "Collected on completed bikes",
      current: revenue(current),
      previous: revenue(previous),
      format: "money",
    },
    {
      label: "Jobs completed",
      current: countInSpan(
        input.jobs.map((job) => job.completedAt),
        current
      ),
      previous: countInSpan(
        input.jobs.map((job) => job.completedAt),
        previous
      ),
      format: "count",
    },
    {
      label: "Jobs approved",
      current: countInSpan(
        input.jobs.map((job) => job.approvedAt),
        current
      ),
      previous: countInSpan(
        input.jobs.map((job) => job.approvedAt),
        previous
      ),
      format: "count",
    },
    {
      label: "Jobs declined",
      current: countInSpan(
        input.jobs.map((job) => job.declinedAt),
        current
      ),
      previous: countInSpan(
        input.jobs.map((job) => job.declinedAt),
        previous
      ),
      format: "count",
    },
    {
      label: "Inspections finished",
      current: countInSpan(input.inspectionCompletedAt, current),
      previous: countInSpan(input.inspectionCompletedAt, previous),
      format: "count",
    },
    {
      label: "Staff hours",
      current: techHours.current,
      previous: techHours.previous,
      format: "hours",
    },
    {
      label: "Job hours",
      current: jobHours.current,
      previous: jobHours.previous,
      format: "hours",
    },
    {
      label: "Efficiency",
      current: efficiencyPercent(jobHours.current, techHours.current),
      previous: efficiencyPercent(jobHours.previous, techHours.previous),
      format: "percent",
    },
  ];

  const parts = {
    needed: input.parts.filter((part) => part.status === "needed").length,
    ordered: input.parts.filter((part) => part.status === "ordered").length,
    inStock: input.parts.filter((part) => part.status === "in_stock").length,
  };

  const finishedLines = finished(current)
    .slice()
    .sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? ""))
    .map((row) =>
      bikeLine(row, new Date(row.completedAt ?? current.endUtc), {
        collectedCents: Math.max(0, row.collectedCents || 0),
        jobs: jobsCompletedInSpan(row.workOrderId, input.jobs, current),
      })
    );

  const arrivedLines = arrived(current)
    .slice()
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((row) => bikeLine(row, current.endUtc, {}));

  const cancelledLines = cancelled(current)
    .slice()
    .sort((a, b) => (b.cancelledAt ?? "").localeCompare(a.cancelledAt ?? ""))
    .map((row) =>
      bikeLine(row, new Date(row.cancelledAt ?? current.endUtc), {
        cancelledAt: row.cancelledAt,
      })
    );

  const open = workOrders.filter(
    (row) =>
      row.status !== "completed" &&
      row.status !== "cancelled" &&
      new Date(row.createdAt).getTime() <= current.endUtc.getTime()
  );
  const groups = new Map<string, WeeklyWorkOrderInput[]>();
  for (const row of open) {
    const list = groups.get(row.status) ?? [];
    list.push(row);
    groups.set(row.status, list);
  }
  const orderedStatuses = [
    ...STILL_HERE_STATUS_ORDER.filter((status) => groups.has(status)),
    ...[...groups.keys()].filter(
      (status) => !STILL_HERE_STATUS_ORDER.includes(status as WorkOrderStatus)
    ),
  ];
  const stillHere: WeeklyStatusGroup[] = orderedStatuses.map((status) => {
    const rows = (groups.get(status) ?? [])
      .slice()
      .sort(
        (a, b) =>
          daysBetween(b.createdAt, current.endUtc) -
          daysBetween(a.createdAt, current.endUtc)
      );
    const bikes = rows.map((row) =>
      bikeLine(row, current.endUtc, {
        notes: notesFor(row.workOrderId, input.timeline, current),
      })
    );
    return { status, label: statusLabel(status), count: bikes.length, bikes };
  });

  return {
    current,
    previous,
    comparison,
    parts,
    finished: finishedLines,
    arrived: arrivedLines,
    cancelled: cancelledLines,
    stillHere,
  };
}

function dedupeWorkOrders(rows: WeeklyWorkOrderInput[]): WeeklyWorkOrderInput[] {
  const byId = new Map<string, WeeklyWorkOrderInput>();
  for (const row of rows) byId.set(row.workOrderId, row);
  return [...byId.values()];
}

function formatMoney(cents: number): string {
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
  }).format(cents / 100);
}

function formatValue(value: number | null, format: WeeklyMetricFormat): string {
  if (value == null) return "—";
  if (format === "money") return formatMoney(value);
  if (format === "hours") return `${roundTenth(value).toFixed(1)} h`;
  if (format === "percent") return `${roundTenth(value).toFixed(1)}%`;
  return String(value);
}

function formatDelta(metric: WeeklyMetric): string {
  if (metric.current == null || metric.previous == null) return "—";
  const diff = roundTenth(metric.current - metric.previous);
  if (diff === 0) return "0";
  const sign = diff > 0 ? "+" : "−";
  const abs = Math.abs(diff);
  if (metric.format === "money") return `${sign}${formatMoney(abs)}`;
  if (metric.format === "hours") return `${sign}${abs.toFixed(1)} h`;
  if (metric.format === "percent") return `${sign}${abs.toFixed(1)} pts`;
  return `${sign}${abs}`;
}

export function formatWeeklyReportSpan(startKey: string, endKey: string): string {
  const start = utcDate(startKey);
  const end = utcDate(endKey);
  const month = new Intl.DateTimeFormat("en-CA", { month: "short", timeZone: "UTC" });
  const day = new Intl.DateTimeFormat("en-CA", { day: "numeric", timeZone: "UTC" });
  const year = new Intl.DateTimeFormat("en-CA", { year: "numeric", timeZone: "UTC" });
  if (startKey.slice(0, 7) === endKey.slice(0, 7)) {
    return `${month.format(start)} ${day.format(start)}–${day.format(end)}, ${year.format(end)}`;
  }
  return `${month.format(start)} ${day.format(start)}, ${year.format(start)} – ${month.format(end)} ${day.format(end)}, ${year.format(end)}`;
}

function utcDate(dateKey: string): Date {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function formatDays(days: number): string {
  const rounded = roundTenth(days);
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  return rounded === 1 ? "1 day" : `${text} days`;
}

function bikeSummary(bike: WeeklyBikeLine, includeMoney: boolean): string {
  const bits = [
    bike.bikeLabel,
    bike.workOrderNumber,
    bike.customerName,
    formatDays(bike.daysInShop),
  ];
  if (!includeMoney) bits.push(bike.statusLabel);
  if (includeMoney && bike.collectedCents != null)
    bits.push(formatMoney(bike.collectedCents));
  return bits.join(" · ");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function renderWeeklyShopReport(
  report: WeeklyShopReport
): WeeklyShopReportMessage {
  const span = formatWeeklyReportSpan(
    report.current.startDateKey,
    report.current.endDateKey
  );
  const subject = `Weekly shop report · ${span}`;
  const intro = `${span}. The seven days ending Friday 8:00 p.m. America/Toronto, compared with the seven days before.`;

  const textLines: string[] = [
    "OTOMOTO TORONTO MOTO INC.",
    subject,
    intro,
    "",
    "Compared with last week",
    ...report.comparison.map(
      (metric) =>
        `${metric.label}: ${formatValue(metric.current, metric.format)} (last week ${formatValue(metric.previous, metric.format)}, ${formatDelta(metric)})`
    ),
    "",
    "In the shop at 8:00 p.m.",
  ];

  if (report.stillHere.length === 0) {
    textLines.push("No bikes in the shop.");
  } else {
    for (const group of report.stillHere) {
      textLines.push(`${group.label}: ${group.count}`);
    }
  }
  textLines.push(
    `Parts still open: ${report.parts.needed} needed, ${report.parts.ordered} ordered, ${report.parts.inStock} in stock.`
  );

  appendBikeSection(textLines, "Finished this week", report.finished, true);
  appendBikeSection(textLines, "Arrived this week", report.arrived, false);
  textLines.push("");
  textLines.push("Cancelled this week");
  if (report.cancelled.length === 0) {
    textLines.push("None.");
  } else {
    for (const bike of report.cancelled) {
      textLines.push(bikeSummary(bike, false));
    }
  }

  textLines.push("");
  textLines.push("Still here");
  if (report.stillHere.length === 0) {
    textLines.push("None.");
  } else {
    for (const group of report.stillHere) {
      textLines.push("");
      textLines.push(group.label);
      for (const bike of group.bikes) {
        textLines.push(bikeSummary(bike, false));
        for (const note of bike.notes) textLines.push(`  - ${note}`);
      }
    }
  }

  const text = textLines.join("\n");
  const html = renderHtml(subject, intro, report);
  return { subject, text, html };
}

function appendBikeSection(
  lines: string[],
  title: string,
  bikes: WeeklyBikeLine[],
  includeMoney: boolean
) {
  lines.push("");
  lines.push(title);
  if (bikes.length === 0) {
    lines.push("None.");
    return;
  }
  for (const bike of bikes) {
    lines.push(bikeSummary(bike, includeMoney));
    if (includeMoney && bike.jobs.length > 0) {
      lines.push(`  Jobs: ${bike.jobs.join(", ")}`);
    }
  }
}

function renderHtml(subject: string, intro: string, report: WeeklyShopReport): string {
  const rows = report.comparison
    .map(
      (metric) =>
        `<tr><td>${escapeHtml(metric.label)}</td><td>${escapeHtml(formatValue(metric.current, metric.format))}</td><td>${escapeHtml(formatValue(metric.previous, metric.format))}</td><td>${escapeHtml(formatDelta(metric))}</td></tr>`
    )
    .join("");
  const snapshot =
    report.stillHere.length === 0
      ? "<p>No bikes in the shop.</p>"
      : `<ul>${report.stillHere
          .map((group) => `<li>${escapeHtml(group.label)}: ${group.count}</li>`)
          .join("")}</ul>`;
  const finished = bikeHtml(report.finished, true);
  const arrived = bikeHtml(report.arrived, false);
  const cancelled =
    report.cancelled.length === 0
      ? "<p>None.</p>"
      : `<ul>${report.cancelled
          .map((bike) => `<li>${escapeHtml(bikeSummary(bike, false))}</li>`)
          .join("")}</ul>`;
  const still =
    report.stillHere.length === 0
      ? "<p>None.</p>"
      : report.stillHere
          .map((group) => {
            const items = group.bikes
              .map((bike) => {
                const notes =
                  bike.notes.length === 0
                    ? ""
                    : `<ul>${bike.notes.map((note) => `<li>${escapeHtml(note)}</li>`).join("")}</ul>`;
                return `<li>${escapeHtml(bikeSummary(bike, false))}${notes}</li>`;
              })
              .join("");
            return `<h3>${escapeHtml(group.label)}</h3><ul>${items}</ul>`;
          })
          .join("");

  return `<!DOCTYPE html>
<html>
<body style="font-family: Georgia, serif; color: #111; line-height: 1.45;">
  <p><strong>OTOMOTO TORONTO MOTO INC.</strong></p>
  <h1>${escapeHtml(subject)}</h1>
  <p>${escapeHtml(intro)}</p>
  <h2>Compared with last week</h2>
  <table cellpadding="6" cellspacing="0" border="1">
    <thead><tr><th>Measure</th><th>This week</th><th>Last week</th><th>Difference</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <h2>In the shop at 8:00 p.m.</h2>
  ${snapshot}
  <p>Parts still open: ${report.parts.needed} needed, ${report.parts.ordered} ordered, ${report.parts.inStock} in stock.</p>
  <h2>Finished this week</h2>
  ${finished}
  <h2>Arrived this week</h2>
  ${arrived}
  <h2>Cancelled this week</h2>
  ${cancelled}
  <h2>Still here</h2>
  ${still}
</body>
</html>`;
}

function bikeHtml(bikes: WeeklyBikeLine[], includeMoney: boolean): string {
  if (bikes.length === 0) return "<p>None.</p>";
  return `<ul>${bikes
    .map((bike) => {
      const jobs =
        includeMoney && bike.jobs.length > 0
          ? `<div>Jobs: ${escapeHtml(bike.jobs.join(", "))}</div>`
          : "";
      return `<li>${escapeHtml(bikeSummary(bike, includeMoney))}${jobs}</li>`;
    })
    .join("")}</ul>`;
}

export type WeeklyReportRunResult =
  { ok: true; skipped: "already_sent" } | { ok: true; messageId: string };

/**
 * Claim the week, send once, and release the claim if sending fails so a
 * retry in the same hour can try again.
 */
export async function runWeeklyShopReport(input: {
  prepare: () => Promise<WeeklyShopReportMessage & { dedupeKey: string }>;
  claim: (dedupeKey: string, text: string) => Promise<"claimed" | "duplicate">;
  send: (message: WeeklyShopReportMessage) => Promise<{ id: string }>;
  markSent: (dedupeKey: string, messageId: string) => Promise<void>;
  release: (dedupeKey: string) => Promise<void>;
}): Promise<WeeklyReportRunResult> {
  const message = await input.prepare();
  const claim = await input.claim(message.dedupeKey, message.text);
  if (claim === "duplicate") return { ok: true, skipped: "already_sent" };
  let sent: { id: string };
  try {
    sent = await input.send(message);
  } catch (error) {
    await input.release(message.dedupeKey);
    throw error;
  }
  await input.markSent(message.dedupeKey, sent.id);
  return { ok: true, messageId: sent.id };
}
