import { requireUser } from "@/lib/auth/session";
import { addAuditLog } from "@/lib/audit/addAuditLog";
import { createClient } from "@/lib/database/supabase-server";
import {
  baselineCaption,
  interpretBikeReading,
  parseBikeLinkSchedule,
  parseBikeReading,
  readingOriginLabel,
  resolveServiceBaseline,
  type BikeLinkReport,
  type BikeLinkSource,
  type BikeReading,
  type ServiceBaseline,
} from "@/lib/bikeLink/reading";
import { normalizeMileageUnit, type MileageUnit } from "@/lib/mileage/format";
import { canUpdateServiceInformation, canViewClients } from "@/lib/permissions";

export type BikeLinkLatest = {
  readingId: string;
  source: BikeLinkSource;
  placeName: string | null;
  origin: string;
  odometer: number | null;
  batteryVolts: number | null;
  faultCodes: string[];
  recordedAt: string;
};

export type BikeLinkView = {
  unit: MileageUnit;
  report: BikeLinkReport | null;
  latest: BikeLinkLatest | null;
  baseline: ServiceBaseline;
  baselineText: string;
  scheduleForm: {
    intervalDistance: number;
    intervalDays: number;
    lastServiceOdometer: string;
    lastServiceOn: string;
  };
};

type ScheduleRow = {
  interval_distance: number;
  interval_days: number;
  last_service_odometer: number | null;
  last_service_on: string | null;
};

type ReadingRow = {
  reading_id: string;
  source: string;
  place_name: string | null;
  odometer: number | null;
  battery_volts: number | string | null;
  fault_codes: string[] | null;
  recorded_at: string;
};

export async function getBikeLink(motorcycleId: string): Promise<BikeLinkView> {
  const user = await requireUser();
  if (!canViewClients(user.role)) throw new Error("FORBIDDEN");
  const supabase = await createClient();
  const unit = await loadUnit(supabase, motorcycleId);
  const [schedule, latest, lastVisit] = await Promise.all([
    loadSchedule(supabase, motorcycleId),
    loadLatestReading(supabase, motorcycleId),
    loadLastVisit(supabase, motorcycleId, unit),
  ]);
  return buildView(unit, schedule, latest, lastVisit);
}

export async function recordBikeReading(
  motorcycleId: string,
  input: {
    source: string;
    placeName: string;
    odometer: string;
    batteryVolts: string;
    faultCodes: string;
    recordedAt: string;
  }
): Promise<void> {
  const user = await requireUser();
  if (!canUpdateServiceInformation(user.role)) throw new Error("FORBIDDEN");
  const supabase = await createClient();
  await loadUnit(supabase, motorcycleId);
  const previous = await loadLatestReading(supabase, motorcycleId);
  const parsed = parseBikeReading({
    ...input,
    previousOdometer: previous?.odometer ?? null,
    now: new Date(),
  });
  if (!parsed.ok) throw new Error(parsed.error);

  const { error } = await supabase.from("bike_link_reading").insert({
    motorcycle_id: motorcycleId,
    source: parsed.reading.source,
    place_name: parsed.reading.placeName,
    odometer: parsed.reading.odometer,
    battery_volts: parsed.reading.batteryVolts,
    fault_codes: parsed.reading.faultCodes,
    recorded_at: parsed.reading.recordedAt.toISOString(),
    recorded_by_user_id: user.user_id,
  });
  if (error) throw error;

  await addAuditLog(supabase, {
    actor_user_id: user.user_id,
    action: "bike_link.reading_recorded",
    entity_type: "motorcycle",
    entity_id: motorcycleId,
    description: `Recorded a bike reading from ${readingOriginLabel(
      parsed.reading.source,
      parsed.reading.placeName
    )}.`,
    new_value: {
      source: parsed.reading.source,
      odometer: parsed.reading.odometer,
      battery_volts: parsed.reading.batteryVolts,
      fault_codes: parsed.reading.faultCodes,
    },
  });
}

export async function saveBikeLinkSchedule(
  motorcycleId: string,
  input: {
    intervalDistance: string;
    intervalDays: string;
    lastServiceOdometer: string;
    lastServiceOn: string;
  }
): Promise<void> {
  const user = await requireUser();
  if (!canUpdateServiceInformation(user.role)) throw new Error("FORBIDDEN");
  const parsed = parseBikeLinkSchedule({ ...input, now: new Date() });
  if (!parsed.ok) throw new Error(parsed.error);

  const supabase = await createClient();
  await loadUnit(supabase, motorcycleId);
  const { error } = await supabase.from("bike_link_schedule").upsert({
    motorcycle_id: motorcycleId,
    interval_distance: parsed.schedule.intervalDistance,
    interval_days: parsed.schedule.intervalDays,
    last_service_odometer: parsed.schedule.lastServiceOdometer,
    last_service_on: parsed.schedule.lastServiceOn,
    updated_at: new Date().toISOString(),
    updated_by_user_id: user.user_id,
  });
  if (error) throw error;
}

function buildView(
  unit: MileageUnit,
  schedule: ScheduleRow | null,
  latest: ReadingRow | null,
  lastVisit: { odometer: number | null; completedAt: Date | null } | null
): BikeLinkView {
  const baseline = resolveServiceBaseline({
    unit,
    schedule: schedule
      ? {
          intervalDistance: schedule.interval_distance,
          intervalDays: schedule.interval_days,
          lastServiceOdometer: schedule.last_service_odometer,
          lastServiceAt: schedule.last_service_on
            ? new Date(`${schedule.last_service_on}T12:00:00.000Z`)
            : null,
        }
      : null,
    lastVisit,
  });
  const reading = latest ? toReading(latest) : null;
  return {
    unit,
    baseline,
    baselineText: baselineCaption(baseline),
    report: reading ? interpretBikeReading(reading, baseline) : null,
    latest: latest
      ? {
          readingId: latest.reading_id,
          source: reading!.source,
          placeName: reading!.placeName,
          origin: readingOriginLabel(reading!.source, reading!.placeName),
          odometer: reading!.odometer,
          batteryVolts: reading!.batteryVolts,
          faultCodes: reading!.faultCodes,
          recordedAt: latest.recorded_at,
        }
      : null,
    scheduleForm: {
      intervalDistance: baseline.intervalDistance,
      intervalDays: baseline.intervalDays,
      lastServiceOdometer:
        baseline.odometerFrom === "schedule" && baseline.lastServiceOdometer != null
          ? String(baseline.lastServiceOdometer)
          : "",
      lastServiceOn:
        baseline.dateFrom === "schedule" && schedule?.last_service_on
          ? schedule.last_service_on
          : "",
    },
  };
}

function toReading(row: ReadingRow): BikeReading {
  const volts =
    row.battery_volts == null || row.battery_volts === ""
      ? null
      : Number(row.battery_volts);
  return {
    odometer: row.odometer == null ? null : Number(row.odometer),
    batteryVolts: volts != null && Number.isFinite(volts) ? volts : null,
    faultCodes: row.fault_codes ?? [],
    recordedAt: new Date(row.recorded_at),
    source: row.source as BikeLinkSource,
    placeName: row.place_name,
  };
}

async function loadUnit(
  supabase: Awaited<ReturnType<typeof createClient>>,
  motorcycleId: string
): Promise<MileageUnit> {
  const { data, error } = await supabase
    .from("motorcycle")
    .select("odometer_unit")
    .eq("motorcycle_id", motorcycleId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("MOTORCYCLE_NOT_FOUND");
  return normalizeMileageUnit(data.odometer_unit);
}

async function loadSchedule(
  supabase: Awaited<ReturnType<typeof createClient>>,
  motorcycleId: string
): Promise<ScheduleRow | null> {
  const { data, error } = await supabase
    .from("bike_link_schedule")
    .select(
      "interval_distance, interval_days, last_service_odometer, last_service_on"
    )
    .eq("motorcycle_id", motorcycleId)
    .maybeSingle();
  if (error) throw error;
  return (data as ScheduleRow | null) ?? null;
}

async function loadLatestReading(
  supabase: Awaited<ReturnType<typeof createClient>>,
  motorcycleId: string
): Promise<ReadingRow | null> {
  const { data, error } = await supabase
    .from("bike_link_reading")
    .select(
      "reading_id, source, place_name, odometer, battery_volts, fault_codes, recorded_at"
    )
    .eq("motorcycle_id", motorcycleId)
    .order("recorded_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as ReadingRow | null) ?? null;
}

async function loadLastVisit(
  supabase: Awaited<ReturnType<typeof createClient>>,
  motorcycleId: string,
  unit: MileageUnit
): Promise<{ odometer: number | null; completedAt: Date | null } | null> {
  const { data, error } = await supabase
    .from("work_order")
    .select("mileage, mileage_unit, completed_at")
    .eq("motorcycle_id", motorcycleId)
    .eq("status", "completed")
    .not("completed_at", "is", null)
    .order("completed_at", { ascending: false })
    .limit(8);
  if (error) throw error;
  const match = (data ?? []).find((row) => {
    if (row.mileage == null) return false;
    return normalizeMileageUnit(row.mileage_unit) === unit;
  });
  if (!match || match.mileage == null || !match.completed_at) return null;
  return {
    odometer: Number(match.mileage),
    completedAt: new Date(match.completed_at),
  };
}
