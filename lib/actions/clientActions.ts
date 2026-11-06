import { shopDateKey } from "@/lib/datetime/format";
import type { WorkOrderStatus } from "@/lib/database/types";
import { isOilChangeService, isSeasonalTuneUp } from "@/lib/forms/serviceLines";
import { normalizePhoneE164 } from "@/lib/phone/e164";

export const CLIENT_ACTION_REASONS = [
  "reply",
  "approval",
  "parts",
  "pickup",
  "pickup_week",
  "shop_days",
  "annual",
  "oil",
  "birthday",
] as const;

export type ClientActionReason = (typeof CLIENT_ACTION_REASONS)[number];

export const SHOP_UPDATE_AFTER_DAYS = 4;
export const PICKUP_WEEK_AFTER_DAYS = 7;
export const ANNUAL_AFTER_DAYS = 365;
export const OIL_AFTER_DAYS = 180;
export const REMINDER_SNOOZE_DAYS = 30;

/** Matches the footer on work-order SMS in lib/services/communications.ts. */
export const SMS_OPT_OUT_FOOTER = "Reply STOP to opt out.";

const CLOSED = new Set<WorkOrderStatus>(["draft", "completed", "cancelled"]);
const HELD_OFF_FLOOR = new Set<WorkOrderStatus>(["in_storage", "insurance"]);
const REMINDERS = new Set<ClientActionReason>(["annual", "oil", "birthday"]);

const TITLES: Record<ClientActionReason, string> = {
  reply: "Customer is waiting on a reply",
  approval: "Approval is waiting",
  parts: "Waiting on parts",
  pickup: "Ready for pickup",
  pickup_week: "Still waiting for pickup",
  shop_days: "In the shop longer than four days",
  annual: "Last visit was a year ago",
  oil: "Oil change is due",
  birthday: "Birthday",
};

const REASON_RANK: Record<ClientActionReason, number> = {
  reply: 0,
  approval: 1,
  parts: 2,
  pickup: 3,
  pickup_week: 4,
  shop_days: 5,
  annual: 6,
  oil: 7,
  birthday: 8,
};

export type ClientActionSmsBlock = "phone" | "opt_out";

export type ClientActionCustomer = {
  customerId: string;
  dateOfBirth: string | null;
  phone: string | null;
  smsOptedOut: boolean;
  hasCompletedVisit: boolean;
};

export type ClientActionVisit = {
  workOrderId: string;
  customerId: string;
  motorcycleId: string;
  status: WorkOrderStatus;
  openedAt: string | null;
  createdAt: string;
  readyForPickupAt: string | null;
  latestMessageDirection: "inbound" | "outbound" | null;
  latestInboundAt: string | null;
  pendingRecommendationIds: string[];
  partsEnteredAt: string | null;
  pickupSmsLoggedAfterReady: boolean;
};

export type ClientActionMotorcycle = {
  motorcycleId: string;
  customerId: string;
  lastCompletedAt: string | null;
  lastOilAt: string | null;
};

export type ClientActionResolution = {
  reason: ClientActionReason;
  cycleKey: string;
  outcome: "sent" | "dismissed";
  snoozeUntil: string | null;
};

export type ClientActionCard = {
  reason: ClientActionReason;
  title: string;
  detail: string;
  customerId: string;
  motorcycleId: string | null;
  workOrderId: string | null;
  cycleKey: string;
  smsBlock: ClientActionSmsBlock | null;
};

export type DecideClientActionsInput = {
  now: string;
  visits: ClientActionVisit[];
  motorcycles: ClientActionMotorcycle[];
  customers: ClientActionCustomer[];
  resolutions: ClientActionResolution[];
};

/**
 * Newest photo first. A front shot wins over a later left-side shot.
 * Rows with no storage path are skipped.
 */
export function chooseVisitPhotoPath(
  rows: Array<{ workOrderId: string; category: string; path: string | null }>
): Map<string, string> {
  const chosen = new Map<string, { category: string; path: string }>();
  for (const row of rows) {
    if (!row.path) continue;
    const current = chosen.get(row.workOrderId);
    if (!current || (row.category === "front" && current.category !== "front")) {
      chosen.set(row.workOrderId, { category: row.category, path: row.path });
    }
  }
  return new Map([...chosen].map(([workOrderId, photo]) => [workOrderId, photo.path]));
}

export function isClientActionOilService(name: string): boolean {
  return isOilChangeService(name) || isSeasonalTuneUp(name);
}

export function shopDaySpan(earlier: string, later: string): number {
  const start = Date.parse(`${earlier}T00:00:00Z`);
  const end = Date.parse(`${later}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  return Math.round((end - start) / 86_400_000);
}

export function addShopDays(shopDate: string, days: number): string {
  const [year, month, day] = shopDate.split("-").map(Number);
  const utc = new Date(Date.UTC(year, month - 1, day));
  utc.setUTCDate(utc.getUTCDate() + days);
  return utc.toISOString().slice(0, 10);
}

export function reminderSnoozeUntil(shopDate: string): string {
  return addShopDays(shopDate, REMINDER_SNOOZE_DAYS);
}

export function composeStaffSms(body: string): string | null {
  const trimmed = body.trim();
  if (!trimmed) return null;
  if (trimmed.includes(SMS_OPT_OUT_FOOTER)) return trimmed;
  return `${trimmed} ${SMS_OPT_OUT_FOOTER}`;
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

export function isShopBirthday(dateOfBirth: string, shopDate: string): boolean {
  const birth = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateOfBirth);
  const today = /^(\d{4})-(\d{2})-(\d{2})$/.exec(shopDate);
  if (!birth || !today) return false;
  const [, , birthMonth, birthDay] = birth;
  const [, year, month, day] = today;
  if (birthMonth === month && birthDay === day) return true;
  return (
    birthMonth === "02" &&
    birthDay === "29" &&
    month === "02" &&
    day === "28" &&
    !isLeapYear(Number(year))
  );
}

function smsBlockFor(
  customer: ClientActionCustomer | undefined
): ClientActionSmsBlock | null {
  if (!customer || normalizePhoneE164(customer.phone) == null) return "phone";
  if (customer.smsOptedOut) return "opt_out";
  return null;
}

function resolutionKey(reason: ClientActionReason, cycleKey: string): string {
  return `${reason}\0${cycleKey}`;
}

function isCleared(
  resolution: ClientActionResolution | undefined,
  shopDate: string,
  reason: ClientActionReason
): boolean {
  if (!resolution) return false;
  if (!REMINDERS.has(reason)) return true;
  if (resolution.outcome === "sent") return true;
  if (!resolution.snoozeUntil) return true;
  return shopDate < resolution.snoozeUntil;
}

function shopDaysLabel(age: number): string {
  return age === 1 ? "1 shop day" : `${age} shop days`;
}

function visitDetail(
  reason: ClientActionReason,
  visit: ClientActionVisit,
  shopDate: string
): string {
  switch (reason) {
    case "reply":
      return "The customer texted and nobody answered.";
    case "approval": {
      const count = visit.pendingRecommendationIds.length;
      return count === 1
        ? "One recommendation is waiting for the customer to approve."
        : `${count} recommendations are waiting for the customer to approve.`;
    }
    case "parts": {
      if (!visit.partsEnteredAt) return "This bike is waiting on parts.";
      const age = shopDaySpan(shopDateKey(visit.partsEnteredAt), shopDate);
      if (age <= 0) return "This bike started waiting on parts today.";
      return `This bike has been waiting on parts for ${shopDaysLabel(age)}.`;
    }
    case "pickup": {
      const age = visit.readyForPickupAt
        ? shopDaySpan(shopDateKey(visit.readyForPickupAt), shopDate)
        : 0;
      if (age <= 0) return "Ready for pickup today.";
      return `Ready for pickup for ${shopDaysLabel(age)}.`;
    }
    case "pickup_week": {
      const age = visit.readyForPickupAt
        ? shopDaySpan(shopDateKey(visit.readyForPickupAt), shopDate)
        : PICKUP_WEEK_AFTER_DAYS;
      return `Still here ${shopDaysLabel(age)} after it was ready.`;
    }
    case "shop_days": {
      const droppedOff = visit.openedAt ?? visit.createdAt;
      const age = shopDaySpan(shopDateKey(droppedOff), shopDate);
      return `In the shop for ${shopDaysLabel(age)}.`;
    }
    default:
      return TITLES[reason];
  }
}

function card(input: {
  reason: ClientActionReason;
  detail: string;
  customerId: string;
  motorcycleId: string | null;
  workOrderId: string | null;
  cycleKey: string;
  smsBlock: ClientActionSmsBlock | null;
}): ClientActionCard {
  return {
    ...input,
    title: TITLES[input.reason],
  };
}

function visitReason(
  visit: ClientActionVisit,
  shopDate: string
): { reason: ClientActionReason; cycleKey: string } | null {
  if (CLOSED.has(visit.status)) return null;

  if (visit.latestMessageDirection === "inbound") {
    return {
      reason: "reply",
      cycleKey: `wo:${visit.workOrderId}:reply:${visit.latestInboundAt ?? "none"}`,
    };
  }

  if (visit.pendingRecommendationIds.length > 0) {
    const ids = [...visit.pendingRecommendationIds].sort().join(",");
    return {
      reason: "approval",
      cycleKey: `wo:${visit.workOrderId}:approval:${ids}`,
    };
  }

  if (visit.status === "waiting_for_parts") {
    return {
      reason: "parts",
      cycleKey: `wo:${visit.workOrderId}:parts:${visit.partsEnteredAt ?? "open"}`,
    };
  }

  if (
    visit.status === "ready_for_pickup" &&
    visit.readyForPickupAt &&
    !HELD_OFF_FLOOR.has(visit.status)
  ) {
    const age = shopDaySpan(shopDateKey(visit.readyForPickupAt), shopDate);
    if (age >= PICKUP_WEEK_AFTER_DAYS) {
      return {
        reason: "pickup_week",
        cycleKey: `wo:${visit.workOrderId}:pickup_week:${visit.readyForPickupAt}`,
      };
    }
    if (!visit.pickupSmsLoggedAfterReady) {
      return {
        reason: "pickup",
        cycleKey: `wo:${visit.workOrderId}:pickup:${visit.readyForPickupAt}`,
      };
    }
    return null;
  }

  if (HELD_OFF_FLOOR.has(visit.status) || visit.status === "ready_for_pickup") {
    return null;
  }

  const droppedOff = visit.openedAt ?? visit.createdAt;
  const age = shopDaySpan(shopDateKey(droppedOff), shopDate);
  if (age >= SHOP_UPDATE_AFTER_DAYS) {
    return {
      reason: "shop_days",
      cycleKey: `wo:${visit.workOrderId}:shop_days`,
    };
  }

  return null;
}

export function decideClientActions(input: DecideClientActionsInput): ClientActionCard[] {
  const shopDate = shopDateKey(input.now);
  const customers = new Map(input.customers.map((row) => [row.customerId, row]));
  const resolutions = new Map(
    input.resolutions.map((row) => [resolutionKey(row.reason, row.cycleKey), row])
  );
  const openCustomerIds = new Set(
    input.visits
      .filter((visit) => !CLOSED.has(visit.status))
      .map((visit) => visit.customerId)
  );

  const cards: ClientActionCard[] = [];

  for (const visit of input.visits) {
    const chosen = visitReason(visit, shopDate);
    if (!chosen) continue;
    const resolution = resolutions.get(resolutionKey(chosen.reason, chosen.cycleKey));
    if (isCleared(resolution, shopDate, chosen.reason)) continue;
    cards.push(
      card({
        reason: chosen.reason,
        detail: visitDetail(chosen.reason, visit, shopDate),
        customerId: visit.customerId,
        motorcycleId: visit.motorcycleId,
        workOrderId: visit.workOrderId,
        cycleKey: chosen.cycleKey,
        smsBlock: smsBlockFor(customers.get(visit.customerId)),
      })
    );
  }

  for (const motorcycle of input.motorcycles) {
    if (openCustomerIds.has(motorcycle.customerId)) continue;
    const customer = customers.get(motorcycle.customerId);
    const block = smsBlockFor(customer);

    if (motorcycle.lastCompletedAt) {
      const age = shopDaySpan(shopDateKey(motorcycle.lastCompletedAt), shopDate);
      const cycleKey = `motorcycle:${motorcycle.motorcycleId}:annual:${motorcycle.lastCompletedAt}`;
      if (
        age >= ANNUAL_AFTER_DAYS &&
        !isCleared(resolutions.get(resolutionKey("annual", cycleKey)), shopDate, "annual")
      ) {
        cards.push(
          card({
            reason: "annual",
            detail: `Last visit was ${shopDaysLabel(age)} ago.`,
            customerId: motorcycle.customerId,
            motorcycleId: motorcycle.motorcycleId,
            workOrderId: null,
            cycleKey,
            smsBlock: block,
          })
        );
      }
    }

    if (motorcycle.lastOilAt) {
      const age = shopDaySpan(shopDateKey(motorcycle.lastOilAt), shopDate);
      const cycleKey = `motorcycle:${motorcycle.motorcycleId}:oil:${motorcycle.lastOilAt}`;
      if (
        age >= OIL_AFTER_DAYS &&
        !isCleared(resolutions.get(resolutionKey("oil", cycleKey)), shopDate, "oil")
      ) {
        cards.push(
          card({
            reason: "oil",
            detail: `Last oil change was ${shopDaysLabel(age)} ago.`,
            customerId: motorcycle.customerId,
            motorcycleId: motorcycle.motorcycleId,
            workOrderId: null,
            cycleKey,
            smsBlock: block,
          })
        );
      }
    }
  }

  const birthdayYear = shopDate.slice(0, 4);
  for (const customer of input.customers) {
    if (openCustomerIds.has(customer.customerId)) continue;
    if (!customer.hasCompletedVisit || !customer.dateOfBirth) continue;
    if (!isShopBirthday(customer.dateOfBirth, shopDate)) continue;
    const cycleKey = `customer:${customer.customerId}:birthday:${birthdayYear}`;
    if (
      isCleared(
        resolutions.get(resolutionKey("birthday", cycleKey)),
        shopDate,
        "birthday"
      )
    ) {
      continue;
    }
    cards.push(
      card({
        reason: "birthday",
        detail: "Today is their birthday.",
        customerId: customer.customerId,
        motorcycleId: null,
        workOrderId: null,
        cycleKey,
        smsBlock: smsBlockFor(customer),
      })
    );
  }

  cards.sort((left, right) => {
    const rank = REASON_RANK[left.reason] - REASON_RANK[right.reason];
    if (rank !== 0) return rank;
    return (
      (left.workOrderId ?? "").localeCompare(right.workOrderId ?? "") ||
      (left.motorcycleId ?? "").localeCompare(right.motorcycleId ?? "") ||
      left.customerId.localeCompare(right.customerId) ||
      left.cycleKey.localeCompare(right.cycleKey)
    );
  });

  return cards;
}
