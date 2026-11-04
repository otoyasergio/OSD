import { formatCalendarDate } from "@/lib/datetime/format";
import { TORONTO_SHOP } from "@/lib/shop/toronto";
import { formatStorageMonthlyAmount, storageDaysLeft } from "@/lib/storage/terms";

export const STORAGE_NOTICE_TEMPLATE = "storage_month_notice";
export const STORAGE_NOTICE_LEAD_DAYS = 30;

const SMS_OPT_OUT_FOOTER = "Reply STOP to opt out.";

export function storageNoticeDedupeKey(storedAt: string): string {
  return `storage:${storedAt}`;
}

export function storageNoticeIsDue(pickupBy: string, today: string): boolean {
  const days = storageDaysLeft(pickupBy, today);
  return Number.isFinite(days) && days <= STORAGE_NOTICE_LEAD_DAYS;
}

/** 15:00 UTC is 10:00 Toronto in winter and 11:00 Toronto in summer. Skip Sunday. */
export function isStorageNoticeHour(now: Date): boolean {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Toronto",
    weekday: "short",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const weekday = parts.find((part) => part.type === "weekday")?.value;
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? "NaN");
  if (weekday === "Sun") return false;
  return hour === 10 || hour === 11;
}

export type StorageNoticeChannelPlan = {
  sms: "send" | "skip_opt_out" | "skip_no_phone" | "skip_sent";
  email: "send" | "skip_no_email" | "skip_sent";
};

export function planStorageMonthNotice(input: {
  today: string;
  pickupBy: string;
  phone: string | null;
  email: string | null;
  smsOptedOut: boolean;
  smsSent: boolean;
  emailSent: boolean;
}): StorageNoticeChannelPlan | null {
  if (!storageNoticeIsDue(input.pickupBy, input.today)) return null;
  const phone = input.phone?.trim() ?? "";
  const email = input.email?.trim() ?? "";
  return {
    sms: input.smsSent
      ? "skip_sent"
      : input.smsOptedOut
        ? "skip_opt_out"
        : phone
          ? "send"
          : "skip_no_phone",
    email: input.emailSent ? "skip_sent" : email ? "send" : "skip_no_email",
  };
}

export type StorageMonthNotice = {
  sms: string;
  emailSubject: string;
  emailHtml: string;
  emailText: string;
};

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function storageMotorcycleLabel(input: {
  year: number | null;
  make: string | null;
  model: string | null;
}): string {
  const parts = [input.year, input.make?.trim(), input.model?.trim()].filter(
    (part) => part != null && String(part).trim() !== ""
  );
  return parts.length > 0 ? parts.join(" ") : "your motorcycle";
}

export function renderStorageMonthNotice(input: {
  customerName: string;
  year: number | null;
  make: string | null;
  model: string | null;
  pickupBy: string;
  monthlyCents: number;
}): StorageMonthNotice {
  const name = input.customerName.trim() || "there";
  const bike = storageMotorcycleLabel(input);
  const dateLabel = formatCalendarDate(input.pickupBy) || input.pickupBy;
  const amount = formatStorageMonthlyAmount(input.monthlyCents);
  const after =
    input.monthlyCents === 0
      ? "After that date there is no monthly storage charge."
      : `After that date, monthly storage is ${amount}.`;
  const sms = `Hi ${name}, storage for your ${bike} at ${TORONTO_SHOP.tradeName}, ${TORONTO_SHOP.streetAddress}, is up on ${dateLabel}. ${after} Hours: ${TORONTO_SHOP.hours}. ${TORONTO_SHOP.sunday}. ${SMS_OPT_OUT_FOOTER}`;
  const safeName = escapeHtml(name);
  const safeBike = escapeHtml(bike);
  const safeDate = escapeHtml(dateLabel);
  const safeAfter = escapeHtml(after);
  const emailHtml = `<p>Hi ${safeName},</p><p>Storage for your <strong>${safeBike}</strong> at ${escapeHtml(TORONTO_SHOP.fullAddress)} is up on <strong>${safeDate}</strong>.</p><p>${safeAfter}</p><p>Hours: ${escapeHtml(TORONTO_SHOP.hours)}. ${escapeHtml(TORONTO_SHOP.sunday)}.</p><p>Phone: ${escapeHtml(TORONTO_SHOP.phoneDisplay)}</p><p>— ${escapeHtml(TORONTO_SHOP.legalName)}</p>`;
  const emailText = [
    `Hi ${name},`,
    "",
    `Storage for your ${bike} at ${TORONTO_SHOP.fullAddress} is up on ${dateLabel}.`,
    after,
    `Hours: ${TORONTO_SHOP.hours}. ${TORONTO_SHOP.sunday}.`,
    `Phone: ${TORONTO_SHOP.phoneDisplay}`,
    "",
    TORONTO_SHOP.legalName,
  ].join("\n");

  return {
    sms,
    emailSubject: `Storage is up ${dateLabel} — ${bike}`,
    emailHtml,
    emailText,
  };
}
