import { formatCalendarDate, shopDateKey } from "@/lib/datetime/format";

/** Calendar days from `today` until `pickupBy`. Both values are `YYYY-MM-DD`. */
export function storageDaysLeft(pickupBy: string, today: string): number {
  const from = calendarUtc(today);
  const to = calendarUtc(pickupBy);
  if (from == null || to == null) return Number.NaN;
  return Math.round((to - from) / 86_400_000);
}

function calendarUtc(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utc = Date.UTC(year, month - 1, day);
  const check = new Date(utc);
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    return null;
  }
  return utc;
}

/** A pickup date on or after today in Toronto, or null when it cannot be stored. */
export function parseStoragePickupDate(raw: string, today: string): string | null {
  const value = raw.trim();
  if (calendarUtc(value) == null || calendarUtc(today) == null) return null;
  if (value < today) return null;
  return value;
}

export function isPastStoragePickupDate(raw: string, today: string): boolean {
  const value = raw.trim();
  return calendarUtc(value) != null && calendarUtc(today) != null && value < today;
}

/** Dollar input to cents. `$0` is allowed. Blank or junk is null. */
export function parseStorageMonthlyCents(raw: string): number | null {
  const trimmed = raw.trim().replace(/^\$/, "").replaceAll(",", "");
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;
  const cents = Math.round(Number(trimmed) * 100);
  if (!Number.isSafeInteger(cents) || cents < 0) return null;
  return cents;
}

export function formatStorageMonthlyAmount(cents: number): string {
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

export type StorageCardTone = "ok" | "warn" | "late";

/** 8 or more days left is green, 1–7 is yellow, due today or past is red. */
export function storageCardTone(daysLeft: number): StorageCardTone {
  if (daysLeft <= 0) return "late";
  if (daysLeft <= 7) return "warn";
  return "ok";
}

export function storageRemainingLabel(daysLeft: number): string {
  if (daysLeft > 1) return `${daysLeft} days left`;
  if (daysLeft === 1) return "1 day left";
  if (daysLeft === 0) return "Due today";
  const past = Math.abs(daysLeft);
  return past === 1 ? "1 day past" : `${past} days past`;
}

/** Days-left color for a stored bike that has a pickup date. Null keeps the old elapsed timer. */
export function storageStayPresentation(
  pickupBy: string | null | undefined,
  monthlyCents: number | null | undefined,
  now: Date
): { tone: StorageCardTone; remaining: string; detail: string } | null {
  if (!pickupBy) return null;
  const today = shopDateKey(now);
  if (!today) return null;
  const days = storageDaysLeft(pickupBy, today);
  if (!Number.isFinite(days)) return null;
  const dateLabel = formatCalendarDate(pickupBy);
  const amount =
    monthlyCents == null
      ? ""
      : `${formatStorageMonthlyAmount(monthlyCents)} / month after`;
  return {
    tone: storageCardTone(days),
    remaining: storageRemainingLabel(days),
    detail: [dateLabel, amount].filter(Boolean).join(" · "),
  };
}

export const CLEARED_STORAGE_TERMS = {
  stored_at: null,
  storage_pickup_by: null,
  storage_monthly_cents: null,
} as const;
