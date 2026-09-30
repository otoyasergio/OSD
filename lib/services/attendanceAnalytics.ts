import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/database/supabase-server";
import { canViewReports } from "@/lib/permissions";
import { getShopWeekRange } from "@/lib/datetime/format";
import {
  MEAL_BREAK_NUDGE_MS,
  ONTARIO_OT_THRESHOLD_MS,
  paidPunchDurationMs,
  punchDurationMs,
  summarizeWeek,
  type PunchForSummary,
  type TimeClockBreakForSummary,
} from "@/lib/services/timeClockShared";
import {
  buildHrmsSuggestions,
  type HrmsSuggestion,
  type StaffAttendanceRow,
} from "@/lib/services/hrmsSuggestions";

export type AttendanceAnalyticsPeriod = "7d" | "30d" | "week";

export type AttendanceStaffStat = StaffAttendanceRow;

export type AttendanceAnalytics = {
  period: AttendanceAnalyticsPeriod;
  total_paid_hours: number;
  total_ot_hours: number;
  meal_miss_count: number;
  currently_signed_in: number;
  staff: AttendanceStaffStat[];
  suggestions: HrmsSuggestion[];
};

function periodStart(period: AttendanceAnalyticsPeriod): Date {
  if (period === "week") {
    return new Date(getShopWeekRange().startUtc);
  }
  const days = period === "7d" ? 7 : 30;
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCDate(start.getUTCDate() - (days - 1));
  return start;
}

function countMealMisses(
  clockInAt: string,
  clockOutAt: string | null,
  breaks: TimeClockBreakForSummary[],
  entryId: string,
  nowMs: number
): number {
  const span = punchDurationMs(clockInAt, clockOutAt, nowMs);
  if (span < MEAL_BREAK_NUDGE_MS) return 0;
  const hasCompletedMeal = breaks.some(
    (b) => b.entry_id === entryId && (b.break_type ?? "meal") === "meal" && b.break_end_at
  );
  return hasCompletedMeal ? 0 : 1;
}

export async function getAttendanceAnalytics(
  period: AttendanceAnalyticsPeriod = "week"
): Promise<AttendanceAnalytics> {
  const user = await requireUser();
  if (!canViewReports(user.role)) throw new Error("FORBIDDEN");
  const locationId = user.active_location_id!;
  const since = periodStart(period).toISOString();
  const nowMs = Date.now();
  const supabase = await createClient();

  const [entriesRes, usersRes, eeRes, docsRes] = await Promise.all([
    supabase
      .from("time_clock_entry")
      .select("entry_id, user_id, clock_in_at, clock_out_at, voided_at, notes")
      .eq("location_id", locationId)
      .is("voided_at", null)
      .gte("clock_in_at", since),
    supabase
      .from("app_user")
      .select("user_id, first_name, last_name, role, status, time_clock_pin_hash")
      .eq("status", "active")
      .in("role", [
        "technician",
        "head_tech",
        "service_advisor",
        "owner",
        "manager",
        "admin",
      ]),
    supabase.from("staff_employment_record").select("user_id, employment_start_date"),
    supabase
      .from("staff_document")
      .select("user_id, category")
      .is("voided_at", null)
      .in("category", ["excess_hours_agreement", "vacation_record"]),
  ]);

  if (entriesRes.error) throw entriesRes.error;
  if (usersRes.error) throw usersRes.error;

  const userById = new Map(
    (usersRes.data ?? []).map((u) => [
      u.user_id,
      {
        first_name: u.first_name as string,
        last_name: u.last_name as string,
        role: u.role as string,
        has_pin: Boolean(u.time_clock_pin_hash),
      },
    ])
  );

  const entryIds = (entriesRes.data ?? []).map((e) => e.entry_id);
  const breaksMap = new Map<string, TimeClockBreakForSummary[]>();
  if (entryIds.length > 0) {
    const { data: breaks, error: bErr } = await supabase
      .from("time_clock_break")
      .select("break_id, entry_id, break_type, break_start_at, break_end_at")
      .in("entry_id", entryIds);
    if (bErr) throw bErr;
    for (const b of breaks ?? []) {
      const list = breaksMap.get(b.entry_id) ?? [];
      list.push({
        break_id: b.break_id,
        entry_id: b.entry_id,
        break_type: b.break_type,
        break_start_at: b.break_start_at,
        break_end_at: b.break_end_at,
      });
      breaksMap.set(b.entry_id, list);
    }
  }

  const startDateMap = new Map<string, boolean>();
  for (const row of eeRes.data ?? []) {
    startDateMap.set(row.user_id, Boolean(row.employment_start_date));
  }
  const excessDoc = new Set<string>();
  const vacationDoc = new Set<string>();
  for (const row of docsRes.data ?? []) {
    if (row.category === "excess_hours_agreement") excessDoc.add(row.user_id);
    if (row.category === "vacation_record") vacationDoc.add(row.user_id);
  }

  type Agg = {
    paid_ms: number;
    meal_misses: number;
    open_punch_hours: number | null;
    first_name: string;
    last_name: string;
    role: string;
    has_pin: boolean;
  };
  const byUser = new Map<string, Agg>();

  for (const [userId, u] of userById) {
    byUser.set(userId, {
      paid_ms: 0,
      meal_misses: 0,
      open_punch_hours: null,
      first_name: u.first_name,
      last_name: u.last_name,
      role: u.role,
      has_pin: u.has_pin,
    });
  }

  const punches: PunchForSummary[] = [];

  for (const row of entriesRes.data ?? []) {
    const au = userById.get(row.user_id) ?? {
      first_name: "Staff",
      last_name: "",
      role: "technician",
      has_pin: false,
    };
    const breaks = breaksMap.get(row.entry_id) ?? [];
    punches.push({
      entry_id: row.entry_id,
      user_id: row.user_id,
      first_name: au.first_name,
      last_name: au.last_name,
      clock_in_at: row.clock_in_at,
      clock_out_at: row.clock_out_at,
      voided_at: row.voided_at,
      breaks,
    });

    let agg = byUser.get(row.user_id);
    if (!agg) {
      agg = {
        paid_ms: 0,
        meal_misses: 0,
        open_punch_hours: null,
        first_name: au.first_name,
        last_name: au.last_name,
        role: au.role,
        has_pin: au.has_pin,
      };
      byUser.set(row.user_id, agg);
    }

    agg.paid_ms += paidPunchDurationMs(
      row.clock_in_at,
      row.clock_out_at,
      breaks,
      row.entry_id,
      nowMs
    );
    agg.meal_misses += countMealMisses(
      row.clock_in_at,
      row.clock_out_at,
      breaks,
      row.entry_id,
      nowMs
    );
    if (!row.clock_out_at) {
      const hours = punchDurationMs(row.clock_in_at, null, nowMs) / 3_600_000;
      agg.open_punch_hours = Math.max(agg.open_punch_hours ?? 0, hours);
    }
  }

  // OT from shop-week summary when period is week; else approximate OT from period paid vs 44h
  const weekRange = getShopWeekRange();
  const weekSummaries =
    period === "week"
      ? summarizeWeek(punches, weekRange, nowMs)
      : summarizeWeek(punches, weekRange, nowMs);

  const otByUser = new Map(weekSummaries.map((w) => [w.user_id, w.ot_ms]));

  let totalPaid = 0;
  let totalOt = 0;
  let mealMisses = 0;
  let signedIn = 0;

  const staff: AttendanceStaffStat[] = [];
  for (const [userId, agg] of byUser) {
    const paidHours = Math.round((agg.paid_ms / 3_600_000) * 10) / 10;
    const otMs = otByUser.get(userId) ?? 0;
    const otHours =
      period === "week"
        ? Math.round((otMs / 3_600_000) * 10) / 10
        : Math.round(
            (Math.max(0, agg.paid_ms - ONTARIO_OT_THRESHOLD_MS) / 3_600_000) * 10
          ) / 10;

    if (agg.open_punch_hours != null) signedIn += 1;
    totalPaid += paidHours;
    totalOt += otHours;
    mealMisses += agg.meal_misses;

    // Only list punchable / staff with activity or floor roles
    if (
      !["technician", "head_tech", "service_advisor", "owner", "manager"].includes(
        agg.role
      ) &&
      paidHours === 0
    ) {
      continue;
    }

    staff.push({
      user_id: userId,
      display_name: `${agg.first_name} ${agg.last_name}`.trim(),
      paid_hours: paidHours,
      ot_hours: otHours,
      meal_misses: agg.meal_misses,
      open_punch_hours: agg.open_punch_hours,
      has_pin: agg.has_pin,
      has_employment_start_date: startDateMap.get(userId) ?? false,
      has_excess_hours_agreement_doc: excessDoc.has(userId),
      has_vacation_record_doc: vacationDoc.has(userId),
      role: agg.role,
    });
  }

  staff.sort((a, b) => b.paid_hours - a.paid_hours);

  return {
    period,
    total_paid_hours: Math.round(totalPaid * 10) / 10,
    total_ot_hours: Math.round(totalOt * 10) / 10,
    meal_miss_count: mealMisses,
    currently_signed_in: signedIn,
    staff,
    suggestions: buildHrmsSuggestions({ staff }),
  };
}
