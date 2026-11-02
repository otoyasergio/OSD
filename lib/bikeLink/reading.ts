import { parseShopLocalDateTimeInput, shopDateKey } from "@/lib/datetime/format";
import type { MileageUnit } from "@/lib/mileage/format";

export const BIKE_LINK_SOURCES = ["shop_bay", "home", "partner"] as const;

export type BikeLinkSource = (typeof BIKE_LINK_SOURCES)[number];

export const DEFAULT_INTERVAL_KM = 6000;
export const DEFAULT_INTERVAL_MI = 4000;
export const DEFAULT_INTERVAL_DAYS = 365;
export const DUE_SOON_KM = 500;
export const DUE_SOON_MI = 300;
export const DUE_SOON_DAYS = 30;

/** Resting 12-volt battery. 12.4 V and above is healthy. Below 12.0 V is flat. */
const BATTERY_OK_TENTHS = 124;
const BATTERY_FLAT_TENTHS = 120;

const FAULT_CODE = /^[A-Z0-9][A-Z0-9-]{0,11}$/;

export type BikeReading = {
  odometer: number | null;
  batteryVolts: number | null;
  faultCodes: string[];
  recordedAt: Date;
  source: BikeLinkSource;
  placeName: string | null;
};

export type ServiceBaseline = {
  unit: MileageUnit;
  intervalDistance: number;
  intervalDays: number;
  dueSoonDistance: number;
  dueSoonDays: number;
  lastServiceOdometer: number | null;
  lastServiceAt: Date | null;
  odometerFrom: "schedule" | "visit" | "none";
  dateFrom: "schedule" | "visit" | "none";
};

export type BikeLinkReport = {
  service: "ok" | "due_soon" | "due" | "unknown";
  serviceDetail: string;
  battery: "ok" | "low" | "flat" | "unknown";
  batteryDetail: string;
  faults: "none" | "present";
  faultDetail: string;
  clientNote: string | null;
};

type ScheduleInput = {
  intervalDistance: number | null;
  intervalDays: number | null;
  lastServiceOdometer: number | null;
  lastServiceAt: Date | null;
} | null;

type VisitInput = {
  odometer: number | null;
  completedAt: Date | null;
} | null;

type Axis = "ok" | "due_soon" | "due" | null;

export function defaultIntervalDistance(unit: MileageUnit): number {
  return unit === "mi" ? DEFAULT_INTERVAL_MI : DEFAULT_INTERVAL_KM;
}

export function dueSoonDistance(unit: MileageUnit): number {
  return unit === "mi" ? DUE_SOON_MI : DUE_SOON_KM;
}

export function resolveServiceBaseline(args: {
  unit: MileageUnit;
  schedule: ScheduleInput;
  lastVisit: VisitInput;
}): ServiceBaseline {
  const schedule = args.schedule;
  const visit = args.lastVisit;
  const lastServiceOdometer =
    schedule?.lastServiceOdometer ?? visit?.odometer ?? null;
  const lastServiceAt = schedule?.lastServiceAt ?? visit?.completedAt ?? null;

  return {
    unit: args.unit,
    intervalDistance:
      schedule?.intervalDistance ?? defaultIntervalDistance(args.unit),
    intervalDays: schedule?.intervalDays ?? DEFAULT_INTERVAL_DAYS,
    dueSoonDistance: dueSoonDistance(args.unit),
    dueSoonDays: DUE_SOON_DAYS,
    lastServiceOdometer,
    lastServiceAt,
    odometerFrom:
      schedule?.lastServiceOdometer != null
        ? "schedule"
        : visit?.odometer != null
          ? "visit"
          : "none",
    dateFrom:
      schedule?.lastServiceAt != null
        ? "schedule"
        : visit?.completedAt != null
          ? "visit"
          : "none",
  };
}

export function interpretBikeReading(
  reading: BikeReading,
  baseline: ServiceBaseline
): BikeLinkReport {
  const faultCodes = reading.faultCodes
    .map((code) => code.trim().toUpperCase())
    .filter((code) => code.length > 0);
  const normalized = { ...reading, faultCodes };
  const distance = distanceAxis(normalized, baseline);
  const time = timeAxis(reading, baseline);
  const service = combineAxes(distance.status, time.status);
  const serviceDetail = serviceDetailText(distance, time, service, baseline.unit);
  const battery = batteryStatus(reading.batteryVolts);
  const batteryDetail = batteryDetailText(reading.batteryVolts, battery);
  const faults = faultCodes.length > 0 ? "present" : "none";
  const faultDetail =
    faults === "present" ? `Fault codes: ${faultCodes.join(", ")}.` : "No fault codes.";

  return {
    service,
    serviceDetail,
    battery,
    batteryDetail,
    faults,
    faultDetail,
    clientNote: clientNote({
      service,
      distance,
      time,
      unit: baseline.unit,
      battery,
      batteryVolts: reading.batteryVolts,
      faultCodes,
    }),
  };
}

type ParseResult =
  | { ok: true; reading: BikeReading }
  | { ok: false; error: string };

export function parseBikeReading(input: {
  source: string;
  placeName: string;
  odometer: string;
  batteryVolts: string;
  faultCodes: string;
  recordedAt: string;
  previousOdometer: number | null;
  now: Date;
}): ParseResult {
  if (!isSource(input.source)) {
    return { ok: false, error: "Choose where this reading was collected." };
  }

  const odometer = parseOdometer(input.odometer);
  if (!odometer.ok) return odometer;
  const batteryVolts = parseVolts(input.batteryVolts);
  if (!batteryVolts.ok) return batteryVolts;
  const faultCodes = parseFaultCodes(input.faultCodes);
  if (!faultCodes.ok) return faultCodes;

  if (
    odometer.value == null &&
    batteryVolts.value == null &&
    faultCodes.value.length === 0
  ) {
    return {
      ok: false,
      error: "Enter kilometers, battery voltage, or a fault code.",
    };
  }

  if (
    odometer.value != null &&
    input.previousOdometer != null &&
    odometer.value < input.previousOdometer
  ) {
    return { ok: false, error: "Odometer is lower than the last reading." };
  }

  const recordedAt = parseShopLocalDateTimeInput(input.recordedAt);
  if (!recordedAt) return { ok: false, error: "Enter when this reading was taken." };
  if (recordedAt.getTime() > input.now.getTime() + 5 * 60 * 1000) {
    return { ok: false, error: "That time is too far ahead." };
  }

  const placeName = input.placeName.trim();
  if (placeName.length > 80) {
    return { ok: false, error: "Place name is too long." };
  }

  return {
    ok: true,
    reading: {
      odometer: odometer.value,
      batteryVolts: batteryVolts.value,
      faultCodes: faultCodes.value,
      recordedAt,
      source: input.source,
      placeName: placeName.length > 0 ? placeName : null,
    },
  };
}

export function readingOriginLabel(
  source: BikeLinkSource,
  placeName: string | null
): string {
  if (placeName) return placeName;
  if (source === "shop_bay") return "Shop";
  if (source === "home") return "Home";
  return "Partner stop";
}

export function parseBikeLinkSchedule(input: {
  intervalDistance: string;
  intervalDays: string;
  lastServiceOdometer: string;
  lastServiceOn: string;
  now: Date;
}):
  | {
      ok: true;
      schedule: {
        intervalDistance: number;
        intervalDays: number;
        lastServiceOdometer: number | null;
        lastServiceOn: string | null;
      };
    }
  | { ok: false; error: string } {
  const intervalDistance = parseBoundedInteger(input.intervalDistance, 100, 100_000);
  if (intervalDistance == null) {
    return { ok: false, error: "Service distance is a whole number from 100 to 100000." };
  }
  const intervalDays = parseBoundedInteger(input.intervalDays, 30, 1095);
  if (intervalDays == null) {
    return { ok: false, error: "Service time is a whole number of days from 30 to 1095." };
  }

  const odometerRaw = input.lastServiceOdometer.trim();
  let lastServiceOdometer: number | null = null;
  if (odometerRaw) {
    if (!/^\d{1,6}$/.test(odometerRaw)) {
      return { ok: false, error: "Last service odometer is a whole number." };
    }
    lastServiceOdometer = Number(odometerRaw);
  }

  const dateRaw = input.lastServiceOn.trim();
  if (dateRaw && !/^\d{4}-\d{2}-\d{2}$/.test(dateRaw)) {
    return { ok: false, error: "Last service date looks like 2026-06-01." };
  }
  if (dateRaw && dateRaw > shopDateKey(input.now)) {
    return { ok: false, error: "Last service date is in the future." };
  }

  return {
    ok: true,
    schedule: {
      intervalDistance,
      intervalDays,
      lastServiceOdometer,
      lastServiceOn: dateRaw || null,
    },
  };
}

function parseBoundedInteger(raw: string, min: number, max: number): number | null {
  const trimmed = raw.trim();
  if (!/^\d{1,6}$/.test(trimmed)) return null;
  const value = Number(trimmed);
  if (value < min || value > max) return null;
  return value;
}

export function baselineCaption(baseline: ServiceBaseline): string {
  const interval = `${formatDistance(baseline.intervalDistance, baseline.unit)} or ${baseline.intervalDays} days`;
  const point = servicePoint(baseline);
  if (!point) {
    return `Service interval is ${interval}. No last service is on file yet.`;
  }
  const from =
    baseline.odometerFrom === "schedule" || baseline.dateFrom === "schedule"
      ? "the saved schedule"
      : "the last completed visit";
  return `Service interval is ${interval}. Last service point: ${point}, from ${from}.`;
}

function servicePoint(baseline: ServiceBaseline): string | null {
  const parts: string[] = [];
  if (baseline.lastServiceOdometer != null) {
    parts.push(formatDistance(baseline.lastServiceOdometer, baseline.unit));
  }
  if (baseline.lastServiceAt) {
    const key = shopDateKey(baseline.lastServiceAt);
    if (key) parts.push(key);
  }
  return parts.length > 0 ? parts.join(" on ") : null;
}

function isSource(value: string): value is BikeLinkSource {
  return (BIKE_LINK_SOURCES as readonly string[]).includes(value);
}

function parseOdometer(
  raw: string
): { ok: true; value: number | null } | { ok: false; error: string } {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: true, value: null };
  if (!/^\d{1,6}$/.test(trimmed)) {
    return { ok: false, error: "Odometer is a whole number." };
  }
  return { ok: true, value: Number(trimmed) };
}

function parseVolts(
  raw: string
): { ok: true; value: number | null } | { ok: false; error: string } {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: true, value: null };
  if (!/^\d{1,2}(\.\d)?$/.test(trimmed)) {
    return { ok: false, error: "Battery voltage uses one decimal, like 12.6." };
  }
  const value = Number(trimmed);
  if (value < 8 || value > 16) {
    return { ok: false, error: "Battery voltage should be between 8 and 16." };
  }
  return { ok: true, value };
}

function parseFaultCodes(
  raw: string
): { ok: true; value: string[] } | { ok: false; error: string } {
  const pieces = raw
    .split(/[\s,;]+/)
    .map((piece) => piece.trim().toUpperCase())
    .filter((piece) => piece.length > 0);
  if (pieces.length > 20) {
    return { ok: false, error: "Too many fault codes in one reading." };
  }
  const unique: string[] = [];
  for (const piece of pieces) {
    if (!FAULT_CODE.test(piece) || !/\d/.test(piece)) {
      return { ok: false, error: "Fault codes look like P0335 or C14." };
    }
    if (!unique.includes(piece)) unique.push(piece);
  }
  return { ok: true, value: unique };
}

function distanceAxis(reading: BikeReading, baseline: ServiceBaseline): {
  status: Axis;
  since: number | null;
  left: number | null;
} {
  if (reading.odometer == null || baseline.lastServiceOdometer == null) {
    return { status: null, since: null, left: null };
  }
  const since = reading.odometer - baseline.lastServiceOdometer;
  if (since < 0) return { status: null, since: null, left: null };
  const left = baseline.intervalDistance - since;
  return { status: axisStatus(left, baseline.dueSoonDistance), since, left };
}

function timeAxis(reading: BikeReading, baseline: ServiceBaseline): {
  status: Axis;
  since: number | null;
  left: number | null;
} {
  if (!baseline.lastServiceAt) return { status: null, since: null, left: null };
  const since = calendarDaysBetween(baseline.lastServiceAt, reading.recordedAt);
  if (since < 0) return { status: null, since: null, left: null };
  const left = baseline.intervalDays - since;
  return { status: axisStatus(left, baseline.dueSoonDays), since, left };
}

function axisStatus(left: number, dueSoon: number): Exclude<Axis, null> {
  if (left <= 0) return "due";
  if (left <= dueSoon) return "due_soon";
  return "ok";
}

function combineAxes(distance: Axis, time: Axis): BikeLinkReport["service"] {
  const known = [distance, time].filter((status): status is Exclude<Axis, null> => status != null);
  if (known.length === 0) return "unknown";
  if (known.includes("due")) return "due";
  if (known.includes("due_soon")) return "due_soon";
  return "ok";
}

function serviceDetailText(
  distance: { status: Axis; since: number | null; left: number | null },
  time: { status: Axis; since: number | null; left: number | null },
  service: BikeLinkReport["service"],
  unit: MileageUnit
): string {
  if (service === "unknown") return "No last service is on file.";
  const parts: string[] = [];
  if (distance.since != null && distance.left != null && distance.status) {
    parts.push(distanceSentence(distance.since, distance.left, distance.status, unit));
  }
  if (time.since != null && time.left != null && time.status) {
    parts.push(timeSentence(time.since, time.left, time.status));
  }
  return parts.join(" ");
}

function distanceSentence(
  since: number,
  left: number,
  status: Exclude<Axis, null>,
  unit: MileageUnit
): string {
  if (status === "due") {
    const over = -left;
    if (over === 0) {
      return `${formatDistance(since, unit)} since the last service, which meets the interval.`;
    }
    return `${formatDistance(since, unit)} since the last service, ${formatDistance(over, unit)} past the interval.`;
  }
  if (status === "due_soon") {
    return `${formatDistance(left, unit)} left before the distance interval.`;
  }
  return `${formatDistance(left, unit)} left in this interval.`;
}

function timeSentence(since: number, left: number, status: Exclude<Axis, null>): string {
  if (status === "due") {
    const over = -left;
    if (over === 0) return `${formatDays(since)} since the last service, which meets the time interval.`;
    return `${formatDays(since)} since the last service, ${formatDays(over)} past the time interval.`;
  }
  if (status === "due_soon") return `${formatDays(left)} left before the time interval.`;
  return `${formatDays(left)} left in the time interval.`;
}

function clientNote(args: {
  service: BikeLinkReport["service"];
  distance: { status: Axis; since: number | null };
  time: { status: Axis; since: number | null };
  unit: MileageUnit;
  battery: BikeLinkReport["battery"];
  batteryVolts: number | null;
  faultCodes: string[];
}): string | null {
  const sentences: string[] = [];
  if (args.service === "due" || args.service === "due_soon") {
    const lead = args.service === "due" ? "Service is due." : "Service is coming due.";
    const because: string[] = [];
    if (
      (args.distance.status === "due" || args.distance.status === "due_soon") &&
      args.distance.since != null
    ) {
      because.push(
        `The bike has done ${formatDistance(args.distance.since, args.unit)} since the last service.`
      );
    }
    if (
      (args.time.status === "due" || args.time.status === "due_soon") &&
      args.time.since != null &&
      args.distance.status !== "due" &&
      args.distance.status !== "due_soon"
    ) {
      because.push(`It has been ${formatDays(args.time.since)} since the last service.`);
    }
    sentences.push([lead, ...because].join(" "));
  }
  if (args.battery === "low" && args.batteryVolts != null) {
    sentences.push(`The battery is low at ${formatVolts(args.batteryVolts)}.`);
  }
  if (args.battery === "flat" && args.batteryVolts != null) {
    sentences.push(`The battery is flat at ${formatVolts(args.batteryVolts)}.`);
  }
  if (args.faultCodes.length === 1) {
    sentences.push(`The bike reported fault code ${args.faultCodes[0]}.`);
  } else if (args.faultCodes.length > 1) {
    sentences.push(`The bike reported fault codes ${joinCodes(args.faultCodes)}.`);
  }
  return sentences.length > 0 ? sentences.join(" ") : null;
}

function batteryStatus(volts: number | null): BikeLinkReport["battery"] {
  if (volts == null) return "unknown";
  const tenths = Math.round(volts * 10);
  if (tenths >= BATTERY_OK_TENTHS) return "ok";
  if (tenths >= BATTERY_FLAT_TENTHS) return "low";
  return "flat";
}

function batteryDetailText(
  volts: number | null,
  status: BikeLinkReport["battery"]
): string {
  if (volts == null || status === "unknown") return "No battery voltage in this reading.";
  if (status === "ok") return `Battery is ${formatVolts(volts)}.`;
  if (status === "low") return `Battery is low at ${formatVolts(volts)}.`;
  return `Battery is flat at ${formatVolts(volts)}.`;
}

function calendarDaysBetween(earlier: Date, later: Date): number {
  const start = shopDateKey(earlier);
  const end = shopDateKey(later);
  if (!start || !end) return 0;
  const [startYear, startMonth, startDay] = start.split("-").map(Number);
  const [endYear, endMonth, endDay] = end.split("-").map(Number);
  const startUtc = Date.UTC(startYear, startMonth - 1, startDay);
  const endUtc = Date.UTC(endYear, endMonth - 1, endDay);
  return Math.round((endUtc - startUtc) / 86_400_000);
}

function formatDistance(value: number, unit: MileageUnit): string {
  return `${formatNumber(value)} ${unit}`;
}

function formatNumber(value: number): string {
  return value.toLocaleString("en-CA");
}

function formatDays(value: number): string {
  return value === 1 ? "1 day" : `${formatNumber(value)} days`;
}

function formatVolts(value: number): string {
  return `${value.toFixed(1)} V`;
}

function joinCodes(codes: string[]): string {
  if (codes.length === 2) return `${codes[0]} and ${codes[1]}`;
  return `${codes.slice(0, -1).join(", ")}, and ${codes[codes.length - 1]}`;
}
