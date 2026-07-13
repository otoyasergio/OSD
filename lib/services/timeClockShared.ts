import {
  parseShopLocalDateTimeInput,
  shopDateKey,
  type ShopWeekRange,
} from "@/lib/datetime/format";

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
  daily: UserDayHours[];
  open_entry_ids: string[];
};

export function summarizeWeek(
  entries: PunchForSummary[],
  range: ShopWeekRange,
  nowMs = Date.now()
): UserWeekSummary[] {
  const byUser = new Map<
    string,
    {
      first_name: string;
      last_name: string;
      dayMs: Map<string, number>;
      openDays: Set<string>;
      open_entry_ids: string[];
    }
  >();

  const dateKeySet = new Set(range.dateKeys);

  for (const entry of entries) {
    let bucket = byUser.get(entry.user_id);
    if (!bucket) {
      bucket = {
        first_name: entry.first_name?.trim() || "",
        last_name: entry.last_name?.trim() || "",
        dayMs: new Map(),
        openDays: new Set(),
        open_entry_ids: [],
      };
      byUser.set(entry.user_id, bucket);
    }

    if (entry.first_name) bucket.first_name = entry.first_name.trim();
    if (entry.last_name) bucket.last_name = entry.last_name.trim();

    const isOpen = !entry.clock_out_at;
    if (isOpen) bucket.open_entry_ids.push(entry.entry_id);

    const allocated = allocatePunchMsByShopDay(
      entry.clock_in_at,
      entry.clock_out_at,
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
    const display_name =
      [bucket.first_name, bucket.last_name].filter(Boolean).join(" ") ||
      user_id;
    summaries.push({
      user_id,
      display_name,
      total_ms,
      daily,
      open_entry_ids: bucket.open_entry_ids,
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
  nowMs = Date.now()
): string {
  const header =
    "employee,user_id,date,clock_in,clock_out,hours,notes,status";
  const lines = [header];

  const sorted = [...entries].sort((a, b) => {
    const nameA = `${a.last_name ?? ""} ${a.first_name ?? ""}`;
    const nameB = `${b.last_name ?? ""} ${b.first_name ?? ""}`;
    const byName = nameA.localeCompare(nameB);
    if (byName !== 0) return byName;
    return a.clock_in_at.localeCompare(b.clock_in_at);
  });

  for (const entry of sorted) {
    const display =
      [entry.first_name?.trim(), entry.last_name?.trim()]
        .filter(Boolean)
        .join(" ") || entry.user_id;
    const date = shopDateKey(entry.clock_in_at);
    const hours = formatHoursDecimal(
      punchDurationMs(entry.clock_in_at, entry.clock_out_at, nowMs)
    );
    const status = entry.clock_out_at ? "closed" : "open";
    lines.push(
      [
        csvEscape(display),
        csvEscape(entry.user_id),
        csvEscape(date),
        csvEscape(entry.clock_in_at),
        csvEscape(entry.clock_out_at ?? ""),
        hours,
        csvEscape(entry.notes ?? ""),
        status,
      ].join(",")
    );
  }

  return `${lines.join("\n")}\n`;
}
