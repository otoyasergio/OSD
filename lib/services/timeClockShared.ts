import {
  parseShopLocalDateTimeInput,
  shopDateKey,
  type ShopWeekRange,
} from "@/lib/datetime/format";

/** Ontario ESA default weekly overtime threshold (hours). */
export const ONTARIO_OT_THRESHOLD_HOURS = 44;
export const ONTARIO_OT_THRESHOLD_MS = ONTARIO_OT_THRESHOLD_HOURS * 60 * 60 * 1000;

/**
 * Soft warning when staff are nearing a full shop week — tell supervisor
 * before crossing into OT territory (Ontario OT at 44h).
 */
export const WEEKLY_HOURS_SUPERVISOR_WARNING_HOURS = 37.5;
export const WEEKLY_HOURS_SUPERVISOR_WARNING_MS =
  WEEKLY_HOURS_SUPERVISOR_WARNING_HOURS * 60 * 60 * 1000;

/** Soft ESA meal-break nudge after this many consecutive paid hours. */
export const MEAL_BREAK_NUDGE_MS = 5 * 60 * 60 * 1000;

/** True when week paid hours are at/above the supervisor-notify threshold and below OT. */
export function shouldWarnSupervisorWeeklyHours(
  weekPaidMs: number,
  warningMs = WEEKLY_HOURS_SUPERVISOR_WARNING_MS,
  otMs = ONTARIO_OT_THRESHOLD_MS
): boolean {
  return weekPaidMs >= warningMs && weekPaidMs < otMs;
}

export type TimeClockBreakForSummary = {
  break_id?: string;
  entry_id: string;
  break_type?: string;
  break_start_at: string;
  break_end_at: string | null;
};

export function formatElapsedMs(startedAt: string, now = Date.now()): string {
  const start = new Date(startedAt).getTime();
  if (Number.isNaN(start)) return "0:00";
  const totalSeconds = Math.max(0, Math.floor((now - start) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function punchDurationMs(
  clockInAt: string,
  clockOutAt: string | null,
  nowMs = Date.now()
): number {
  const start = new Date(clockInAt).getTime();
  if (Number.isNaN(start)) return 0;
  const end = clockOutAt ? new Date(clockOutAt).getTime() : nowMs;
  if (Number.isNaN(end) || end < start) return 0;
  return end - start;
}

/** Unpaid break duration within a punch (open breaks use nowMs). */
export function breakDurationMs(
  breakStartAt: string,
  breakEndAt: string | null,
  nowMs = Date.now()
): number {
  return punchDurationMs(breakStartAt, breakEndAt, nowMs);
}

export function unpaidBreakMsForEntry(
  breaks: TimeClockBreakForSummary[],
  entryId: string,
  nowMs = Date.now()
): number {
  let total = 0;
  for (const b of breaks) {
    if (b.entry_id !== entryId) continue;
    total += breakDurationMs(b.break_start_at, b.break_end_at, nowMs);
  }
  return total;
}

/** Paid ms = gross punch span minus unpaid breaks. */
export function paidPunchDurationMs(
  clockInAt: string,
  clockOutAt: string | null,
  breaks: TimeClockBreakForSummary[],
  entryId: string,
  nowMs = Date.now()
): number {
  const gross = punchDurationMs(clockInAt, clockOutAt, nowMs);
  const unpaid = unpaidBreakMsForEntry(breaks, entryId, nowMs);
  return Math.max(0, gross - unpaid);
}

export function splitRegularAndOtMs(
  paidMs: number,
  otThresholdMs = ONTARIO_OT_THRESHOLD_MS
): { regular_ms: number; ot_ms: number } {
  const paid = Math.max(0, paidMs);
  const regular_ms = Math.min(paid, otThresholdMs);
  const ot_ms = Math.max(0, paid - otThresholdMs);
  return { regular_ms, ot_ms };
}

/**
 * True when an open punch has been on the clock ≥ 5h without a completed meal break
 * (and is not currently on an open break).
 */
export function shouldNudgeMealBreak(
  clockInAt: string,
  breaks: TimeClockBreakForSummary[],
  entryId: string,
  nowMs = Date.now()
): boolean {
  const entryBreaks = breaks.filter((b) => b.entry_id === entryId);
  if (entryBreaks.some((b) => !b.break_end_at)) return false;
  const hasCompletedMeal = entryBreaks.some(
    (b) => (b.break_type ?? "meal") === "meal" && b.break_end_at
  );
  if (hasCompletedMeal) return false;
  const elapsed = punchDurationMs(clockInAt, null, nowMs);
  return elapsed >= MEAL_BREAK_NUDGE_MS;
}

export function formatHoursDecimal(ms: number, digits = 2): string {
  const hours = Math.max(0, ms) / (60 * 60 * 1000);
  return hours.toFixed(digits);
}

function shopMidnightUtc(year: number, month: number, day: number): Date {
  const normalized = new Date(Date.UTC(year, month - 1, day));
  const y = normalized.getUTCFullYear();
  const m = normalized.getUTCMonth() + 1;
  const d = normalized.getUTCDate();
  const parsed = parseShopLocalDateTimeInput(
    `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}T00:00:00`
  );
  return parsed ?? new Date(Date.UTC(y, m - 1, d));
}

/** Split punch duration across America/Toronto calendar days. */
export function allocatePunchMsByShopDay(
  clockInAt: string,
  clockOutAt: string | null,
  nowMs = Date.now()
): Map<string, number> {
  const result = new Map<string, number>();
  const startMs = new Date(clockInAt).getTime();
  if (Number.isNaN(startMs)) return result;
  const endMs = clockOutAt ? new Date(clockOutAt).getTime() : nowMs;
  if (Number.isNaN(endMs) || endMs <= startMs) return result;

  let cursor = startMs;
  while (cursor < endMs) {
    const dateKey = shopDateKey(new Date(cursor));
    if (!dateKey) break;
    const [y, m, d] = dateKey.split("-").map(Number);
    const nextMidnight = shopMidnightUtc(y, m, d + 1);
    const sliceEnd = Math.min(endMs, nextMidnight.getTime());
    const sliceMs = sliceEnd - cursor;
    if (sliceMs <= 0) break;
    result.set(dateKey, (result.get(dateKey) ?? 0) + sliceMs);
    cursor = sliceEnd;
  }
  return result;
}

export type PunchForSummary = {
  entry_id: string;
  user_id: string;
  first_name?: string | null;
  last_name?: string | null;
  clock_in_at: string;
  clock_out_at: string | null;
  notes?: string | null;
  voided_at?: string | null;
  breaks?: TimeClockBreakForSummary[];
  week_approval?: string | null;
};

export type UserDayHours = {
  dateKey: string;
  ms: number;
  open: boolean;
};

export type UserWeekSummary = {
  user_id: string;
  display_name: string;
  total_ms: number;
  regular_ms: number;
  ot_ms: number;
  unpaid_break_ms: number;
  daily: UserDayHours[];
  open_entry_ids: string[];
  week_approval: string | null;
};

/** Allocate paid ms across shop days (gross day slices scaled by paid/gross ratio). */
export function allocatePaidMsByShopDay(
  clockInAt: string,
  clockOutAt: string | null,
  breaks: TimeClockBreakForSummary[],
  entryId: string,
  nowMs = Date.now()
): Map<string, number> {
  const grossByDay = allocatePunchMsByShopDay(clockInAt, clockOutAt, nowMs);
  const gross = punchDurationMs(clockInAt, clockOutAt, nowMs);
  if (gross <= 0) return new Map();
  const paid = paidPunchDurationMs(clockInAt, clockOutAt, breaks, entryId, nowMs);
  const ratio = paid / gross;
  const result = new Map<string, number>();
  for (const [dateKey, ms] of grossByDay) {
    result.set(dateKey, ms * ratio);
  }
  return result;
}

export function summarizeWeek(
  entries: PunchForSummary[],
  range: ShopWeekRange,
  nowMs = Date.now(),
  otThresholdMs = ONTARIO_OT_THRESHOLD_MS
): UserWeekSummary[] {
  const byUser = new Map<
    string,
    {
      first_name: string;
      last_name: string;
      dayMs: Map<string, number>;
      openDays: Set<string>;
      open_entry_ids: string[];
      unpaid_break_ms: number;
      week_approval: string | null;
    }
  >();

  const dateKeySet = new Set(range.dateKeys);

  for (const entry of entries) {
    if (entry.voided_at) continue;

    let bucket = byUser.get(entry.user_id);
    if (!bucket) {
      bucket = {
        first_name: entry.first_name?.trim() || "",
        last_name: entry.last_name?.trim() || "",
        dayMs: new Map(),
        openDays: new Set(),
        open_entry_ids: [],
        unpaid_break_ms: 0,
        week_approval: entry.week_approval ?? null,
      };
      byUser.set(entry.user_id, bucket);
    }

    if (entry.first_name) bucket.first_name = entry.first_name.trim();
    if (entry.last_name) bucket.last_name = entry.last_name.trim();
    if (entry.week_approval) bucket.week_approval = entry.week_approval;

    const breaks = entry.breaks ?? [];
    bucket.unpaid_break_ms += unpaidBreakMsForEntry(breaks, entry.entry_id, nowMs);

    const isOpen = !entry.clock_out_at;
    if (isOpen) bucket.open_entry_ids.push(entry.entry_id);

    const allocated = allocatePaidMsByShopDay(
      entry.clock_in_at,
      entry.clock_out_at,
      breaks,
      entry.entry_id,
      nowMs
    );
    for (const [dateKey, ms] of allocated) {
      if (!dateKeySet.has(dateKey)) continue;
      bucket.dayMs.set(dateKey, (bucket.dayMs.get(dateKey) ?? 0) + ms);
      if (isOpen) bucket.openDays.add(dateKey);
    }
  }

  const summaries: UserWeekSummary[] = [];
  for (const [user_id, bucket] of byUser) {
    const daily: UserDayHours[] = range.dateKeys.map((dateKey) => ({
      dateKey,
      ms: bucket.dayMs.get(dateKey) ?? 0,
      open: bucket.openDays.has(dateKey),
    }));
    const total_ms = daily.reduce((sum, day) => sum + day.ms, 0);
    const { regular_ms, ot_ms } = splitRegularAndOtMs(total_ms, otThresholdMs);
    const display_name =
      [bucket.first_name, bucket.last_name].filter(Boolean).join(" ") || user_id;
    summaries.push({
      user_id,
      display_name,
      total_ms,
      regular_ms,
      ot_ms,
      unpaid_break_ms: bucket.unpaid_break_ms,
      daily,
      open_entry_ids: bucket.open_entry_ids,
      week_approval: bucket.week_approval,
    });
  }

  summaries.sort((a, b) => a.display_name.localeCompare(b.display_name));
  return summaries;
}

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function buildTimesheetCsv(
  entries: PunchForSummary[],
  nowMs = Date.now(),
  summaries?: UserWeekSummary[]
): string {
  const header =
    "employee,user_id,date,clock_in,clock_out,gross_hours,unpaid_break_minutes,paid_hours,notes,status,week_approval";
  const lines = [header];

  const sorted = [...entries]
    .filter((e) => !e.voided_at)
    .sort((a, b) => {
      const nameA = `${a.last_name ?? ""} ${a.first_name ?? ""}`;
      const nameB = `${b.last_name ?? ""} ${b.first_name ?? ""}`;
      const byName = nameA.localeCompare(nameB);
      if (byName !== 0) return byName;
      return a.clock_in_at.localeCompare(b.clock_in_at);
    });

  for (const entry of sorted) {
    const display =
      [entry.first_name?.trim(), entry.last_name?.trim()].filter(Boolean).join(" ") ||
      entry.user_id;
    const date = shopDateKey(entry.clock_in_at);
    const breaks = entry.breaks ?? [];
    const grossMs = punchDurationMs(entry.clock_in_at, entry.clock_out_at, nowMs);
    const unpaidMs = unpaidBreakMsForEntry(breaks, entry.entry_id, nowMs);
    const paidMs = Math.max(0, grossMs - unpaidMs);
    const status = entry.clock_out_at ? "closed" : "open";
    lines.push(
      [
        csvEscape(display),
        csvEscape(entry.user_id),
        csvEscape(date),
        csvEscape(entry.clock_in_at),
        csvEscape(entry.clock_out_at ?? ""),
        formatHoursDecimal(grossMs),
        formatHoursDecimal(unpaidMs / 60_000, 0) === "0"
          ? String(Math.round(unpaidMs / 60_000))
          : String(Math.round(unpaidMs / 60_000)),
        formatHoursDecimal(paidMs),
        csvEscape(entry.notes ?? ""),
        status,
        csvEscape(entry.week_approval ?? "open"),
      ].join(",")
    );
  }

  if (summaries && summaries.length > 0) {
    lines.push("");
    lines.push(
      "employee,user_id,paid_hours,regular_hours,ot_hours,unpaid_break_minutes,week_approval"
    );
    for (const row of summaries) {
      lines.push(
        [
          csvEscape(row.display_name),
          csvEscape(row.user_id),
          formatHoursDecimal(row.total_ms),
          formatHoursDecimal(row.regular_ms),
          formatHoursDecimal(row.ot_ms),
          String(Math.round(row.unpaid_break_ms / 60_000)),
          csvEscape(row.week_approval ?? "open"),
        ].join(",")
      );
    }
  }

  return `${lines.join("\n")}\n`;
}

export type ShiftCalendarDay = {
  dateKey: string;
  inMonth: boolean;
  ms: number;
  open: boolean;
  entryCount: number;
};

export type ShiftMonthCalendar = {
  monthKey: string;
  prevMonthKey: string;
  nextMonthKey: string;
  label: string;
  days: ShiftCalendarDay[];
  total_ms: number;
};

function addDaysToDateKey(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d + days));
  return `${utc.getUTCFullYear()}-${String(utc.getUTCMonth() + 1).padStart(2, "0")}-${String(utc.getUTCDate()).padStart(2, "0")}`;
}

function weekdayIndexMondayBased(dateKey: string): number {
  const [y, m, d] = dateKey.split("-").map(Number);
  // UTC noon avoids DST edge cases for calendar arithmetic
  const weekday = new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay(); // 0=Sun
  return weekday === 0 ? 6 : weekday - 1;
}

function shiftMonthKey(monthKey: string, delta: number): string {
  const [y, m] = monthKey.split("-").map(Number);
  const utc = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${utc.getUTCFullYear()}-${String(utc.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(monthKey: string): string {
  const [y, m] = monthKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1, 12)).toLocaleDateString("en-CA", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** Short hour label for calendar cells (e.g. "8h", "8.5h", "1m"). */
export function shiftHoursLabel(ms: number): string {
  if (ms <= 0) return "";
  const hours = ms / (60 * 60 * 1000);
  if (hours < 0.05) {
    return `${Math.max(1, Math.round(ms / 60_000))}m`;
  }
  if (Number.isInteger(hours) || Math.abs(hours - Math.round(hours)) < 0.05) {
    return `${Math.round(hours)}h`;
  }
  const rounded = Math.round(hours * 10) / 10;
  return `${rounded}h`;
}

/**
 * Mon–Sun month grid with hours allocated per shop day for the given punches.
 */
export function buildShiftMonthCalendar(
  entries: Array<{
    entry_id: string;
    user_id?: string;
    clock_in_at: string;
    clock_out_at: string | null;
  }>,
  range: { monthKey: string; dateKeys: string[] },
  nowMs = Date.now()
): ShiftMonthCalendar {
  const inMonth = new Set(range.dateKeys);
  const dayMs = new Map<string, number>();
  const openDays = new Set<string>();
  const entryIdsByDay = new Map<string, Set<string>>();

  for (const entry of entries) {
    const isOpen = !entry.clock_out_at;
    const allocated = allocatePunchMsByShopDay(
      entry.clock_in_at,
      entry.clock_out_at,
      nowMs
    );
    for (const [dateKey, ms] of allocated) {
      if (!inMonth.has(dateKey)) continue;
      dayMs.set(dateKey, (dayMs.get(dateKey) ?? 0) + ms);
      if (isOpen) openDays.add(dateKey);
      let ids = entryIdsByDay.get(dateKey);
      if (!ids) {
        ids = new Set();
        entryIdsByDay.set(dateKey, ids);
      }
      ids.add(entry.entry_id);
    }
  }

  const firstOfMonth = range.dateKeys[0];
  const padStart = firstOfMonth ? weekdayIndexMondayBased(firstOfMonth) : 0;
  const gridStart = firstOfMonth
    ? addDaysToDateKey(firstOfMonth, -padStart)
    : range.monthKey + "-01";
  const lastOfMonth = range.dateKeys[range.dateKeys.length - 1] ?? gridStart;
  const padEnd = 6 - weekdayIndexMondayBased(lastOfMonth);
  const totalDays = padStart + range.dateKeys.length + padEnd;

  const days: ShiftCalendarDay[] = Array.from({ length: totalDays }, (_, i) => {
    const dateKey = addDaysToDateKey(gridStart, i);
    const belongs = inMonth.has(dateKey);
    return {
      dateKey,
      inMonth: belongs,
      ms: belongs ? (dayMs.get(dateKey) ?? 0) : 0,
      open: belongs ? openDays.has(dateKey) : false,
      entryCount: belongs ? (entryIdsByDay.get(dateKey)?.size ?? 0) : 0,
    };
  });

  const total_ms = range.dateKeys.reduce((sum, key) => sum + (dayMs.get(key) ?? 0), 0);

  return {
    monthKey: range.monthKey,
    prevMonthKey: shiftMonthKey(range.monthKey, -1),
    nextMonthKey: shiftMonthKey(range.monthKey, 1),
    label: monthLabel(range.monthKey),
    days,
    total_ms,
  };
}
