/** Shop-local timezone for consistent SSR + client display. */
export const SHOP_TIMEZONE = "America/Toronto";

const LOCALE = "en-CA";

const DATE_OPTS: Intl.DateTimeFormatOptions = {
  timeZone: SHOP_TIMEZONE,
  year: "numeric",
  month: "short",
  day: "numeric",
};

const TIME_OPTS: Intl.DateTimeFormatOptions = {
  timeZone: SHOP_TIMEZONE,
  hour: "numeric",
  minute: "2-digit",
};

const DATE_TIME_OPTS: Intl.DateTimeFormatOptions = {
  ...DATE_OPTS,
  ...TIME_OPTS,
};

function toDate(value: string | Date | null | undefined): Date | null {
  if (value == null || value === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

/** Full date + time in America/Toronto (e.g. "Jul 12, 2026, 2:30 p.m."). */
export function formatDateTime(value: string | Date | null | undefined): string {
  const date = toDate(value);
  if (!date) return "";
  return date.toLocaleString(LOCALE, DATE_TIME_OPTS);
}

/** Date only in America/Toronto (e.g. "Jul 12, 2026"). */
export function formatDate(value: string | Date | null | undefined): string {
  const date = toDate(value);
  if (!date) return "";
  return date.toLocaleDateString(LOCALE, DATE_OPTS);
}

/** Format a date-only `YYYY-MM-DD` value without shifting it across timezones. */
export function formatCalendarDate(value: string | null | undefined): string {
  if (!value) return "";
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return "";
  const date = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  );
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(LOCALE, { ...DATE_OPTS, timeZone: "UTC" });
}

/** Time only in America/Toronto (e.g. "2:30 p.m."). */
export function formatTime(value: string | Date | null | undefined): string {
  const date = toDate(value);
  if (!date) return "";
  return date.toLocaleTimeString(LOCALE, TIME_OPTS);
}

/**
 * Parse a datetime-local input (`YYYY-MM-DDTHH:mm` or with seconds) as
 * America/Toronto wall time and return a UTC Date.
 */
export function parseShopLocalDateTimeInput(raw: string): Date | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const match = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) {
    const fallback = new Date(trimmed);
    return Number.isNaN(fallback.getTime()) ? null : fallback;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6] ?? "0");

  return zonedWallTimeToUtc(year, month, day, hour, minute, second, SHOP_TIMEZONE);
}

/** Convert a wall-clock time in `timeZone` to a UTC Date. */
function zonedWallTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  timeZone: string
): Date {
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, second);
  const offsetMs = getTimeZoneOffsetMs(timeZone, utcGuess);
  const instant = utcGuess - offsetMs;
  // Re-check offset in case the first guess crossed a DST boundary.
  const refinedOffset = getTimeZoneOffsetMs(timeZone, instant);
  return new Date(utcGuess - refinedOffset);
}

function getTimeZoneOffsetMs(timeZone: string, instantMs: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(instantMs));

  const get = (type: Intl.DateTimeFormatPartTypes) => {
    const value = parts.find((p) => p.type === type)?.value;
    return value ? Number(value) : 0;
  };

  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second")
  );
  return asUtc - instantMs;
}

/** YYYY-MM-DD calendar date in America/Toronto. */
export function shopDateKey(value: string | Date | null | undefined): string {
  const date = toDate(value);
  if (!date) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: SHOP_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const year = parts.find((p) => p.type === "year")?.value;
  const month = parts.find((p) => p.type === "month")?.value;
  const day = parts.find((p) => p.type === "day")?.value;
  if (!year || !month || !day) return "";
  return `${year}-${month}-${day}`;
}

/**
 * Value for `<input type="datetime-local">` showing America/Toronto wall time
 * (`YYYY-MM-DDTHH:mm`).
 */
export function toShopDatetimeLocalValue(
  value: string | Date | null | undefined
): string {
  const date = toDate(value);
  if (!date) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: SHOP_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";
  const year = get("year");
  const month = get("month");
  const day = get("day");
  const hour = get("hour");
  const minute = get("minute");
  if (!year || !month || !day || !hour || !minute) return "";
  return `${year}-${month}-${day}T${hour}:${minute}`;
}

export type ShopWeekRange = {
  /** Monday 00:00:00.000 America/Toronto as UTC Date. */
  startUtc: Date;
  /** Exclusive end: next Monday 00:00:00.000 America/Toronto as UTC Date. */
  endUtc: Date;
  startDateKey: string;
  endDateKey: string;
  dateKeys: string[];
};

const WEEKDAY_TO_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

function shopWeekdayIndex(date: Date): number {
  const label = new Intl.DateTimeFormat("en-US", {
    timeZone: SHOP_TIMEZONE,
    weekday: "short",
  }).format(date);
  return WEEKDAY_TO_INDEX[label] ?? 0;
}

function addDaysToDateKey(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d + days));
  return `${utc.getUTCFullYear()}-${String(utc.getUTCMonth() + 1).padStart(2, "0")}-${String(utc.getUTCDate()).padStart(2, "0")}`;
}

function shopMidnightFromDateKey(dateKey: string): Date {
  const parsed = parseShopLocalDateTimeInput(`${dateKey}T00:00:00`);
  if (!parsed) throw new Error(`Invalid shop date key: ${dateKey}`);
  return parsed;
}

/**
 * Monday–Sunday week containing `anchor`, in America/Toronto.
 * `endUtc` is exclusive (next Monday midnight).
 */
export function getShopWeekRange(anchor: string | Date = new Date()): ShopWeekRange {
  const date = toDate(anchor) ?? new Date();
  const anchorKey = shopDateKey(date);
  const weekday = shopWeekdayIndex(date);
  // Monday-based: Sun(0) → back 6; Mon(1) → back 0; … Sat(6) → back 5
  const daysFromMonday = weekday === 0 ? 6 : weekday - 1;
  const startDateKey = addDaysToDateKey(anchorKey, -daysFromMonday);
  const endDateKey = addDaysToDateKey(startDateKey, 6);
  const nextMondayKey = addDaysToDateKey(startDateKey, 7);
  const dateKeys = Array.from({ length: 7 }, (_, i) => addDaysToDateKey(startDateKey, i));
  return {
    startUtc: shopMidnightFromDateKey(startDateKey),
    endUtc: shopMidnightFromDateKey(nextMondayKey),
    startDateKey,
    endDateKey,
    dateKeys,
  };
}

export type ShopMonthRange = {
  /** First day of month 00:00:00.000 America/Toronto as UTC Date. */
  startUtc: Date;
  /** Exclusive end: first day of next month 00:00:00.000 America/Toronto. */
  endUtc: Date;
  monthKey: string;
  startDateKey: string;
  endDateKey: string;
  dateKeys: string[];
};

function parseMonthKey(value: string): { year: number; month: number } | null {
  const match = /^(\d{4})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  return { year, month };
}

/**
 * Calendar month containing `anchor`, in America/Toronto.
 * Accepts a Date/ISO string or a `YYYY-MM` month key.
 * `endUtc` is exclusive (first of next month midnight).
 */
export function getShopMonthRange(anchor: string | Date = new Date()): ShopMonthRange {
  let year: number;
  let month: number;

  if (typeof anchor === "string") {
    const fromKey = parseMonthKey(anchor);
    if (fromKey) {
      year = fromKey.year;
      month = fromKey.month;
    } else {
      const date = toDate(anchor) ?? new Date();
      const key = shopDateKey(date);
      const [y, m] = key.split("-").map(Number);
      year = y;
      month = m;
    }
  } else {
    const date = toDate(anchor) ?? new Date();
    const key = shopDateKey(date);
    const [y, m] = key.split("-").map(Number);
    year = y;
    month = m;
  }

  const monthKey = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`;
  const startDateKey = `${monthKey}-01`;
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  const nextStartKey = `${String(nextYear).padStart(4, "0")}-${String(nextMonth).padStart(2, "0")}-01`;
  const endDateKey = addDaysToDateKey(nextStartKey, -1);
  const dayCount =
    (Date.UTC(nextYear, nextMonth - 1, 1) - Date.UTC(year, month - 1, 1)) /
    (24 * 60 * 60 * 1000);
  const dateKeys = Array.from({ length: dayCount }, (_, i) =>
    addDaysToDateKey(startDateKey, i)
  );

  return {
    startUtc: shopMidnightFromDateKey(startDateKey),
    endUtc: shopMidnightFromDateKey(nextStartKey),
    monthKey,
    startDateKey,
    endDateKey,
    dateKeys,
  };
}
