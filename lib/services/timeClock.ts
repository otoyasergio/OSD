import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/database/supabase-server";
import { addAuditLog } from "@/lib/audit/addAuditLog";
import { canClockStaff, canManageTimesheets, isFloorTech } from "@/lib/permissions";
import type { UserRole } from "@/lib/database/types";
import {
  getShopWeekRange,
  getShopMonthRange,
  parseShopLocalDateTimeInput,
  shopDateKey,
  type ShopWeekRange,
  type ShopMonthRange,
} from "@/lib/datetime/format";
import {
  buildTimesheetCsv,
  buildShiftMonthCalendar,
  formatElapsedMs,
  shouldNudgeMealBreak,
  summarizeWeek,
  type PunchForSummary,
  type ShiftMonthCalendar,
  type ShiftCalendarDay,
  type TimeClockBreakForSummary,
  type UserWeekSummary,
} from "@/lib/services/timeClockShared";

export type TimeClockBreak = {
  break_id: string;
  entry_id: string;
  break_type: "meal" | "other";
  break_start_at: string;
  break_end_at: string | null;
};

export type TimeClockEntry = {
  entry_id: string;
  user_id: string;
  location_id: string;
  clock_in_at: string;
  clock_out_at: string | null;
  notes: string | null;
  voided_at: string | null;
};

export type TimeClockEntryWithUser = TimeClockEntry & {
  first_name: string;
  last_name: string;
  breaks?: TimeClockBreak[];
};

export type TimesheetStaffOption = {
  user_id: string;
  first_name: string;
  last_name: string;
  role: string;
};

export type TimesheetWeekStatus = "open" | "submitted" | "approved" | "rejected";

export type TimesheetWeekRow = {
  timesheet_week_id: string;
  user_id: string;
  location_id: string;
  week_start_date: string;
  status: TimesheetWeekStatus;
  submitted_at: string | null;
  approved_by: string | null;
  approved_at: string | null;
  note: string | null;
};

const ENTRY_COLUMNS =
  "entry_id, user_id, location_id, clock_in_at, clock_out_at, notes, voided_at";
const BREAK_COLUMNS = "break_id, entry_id, break_type, break_start_at, break_end_at";
const WEEK_COLUMNS =
  "timesheet_week_id, user_id, location_id, week_start_date, status, submitted_at, approved_by, approved_at, note";

async function requireTimesheetManager() {
  const user = await requireUser();
  if (!canManageTimesheets(user.role)) throw new Error("FORBIDDEN");
  return user;
}

function mapBreak(row: {
  break_id: string;
  entry_id: string;
  break_type: string;
  break_start_at: string;
  break_end_at: string | null;
}): TimeClockBreak {
  return {
    break_id: row.break_id,
    entry_id: row.entry_id,
    break_type: row.break_type === "other" ? "other" : "meal",
    break_start_at: row.break_start_at,
    break_end_at: row.break_end_at,
  };
}

async function loadBreaksForEntries(
  entryIds: string[]
): Promise<Map<string, TimeClockBreak[]>> {
  const map = new Map<string, TimeClockBreak[]>();
  if (entryIds.length === 0) return map;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("time_clock_break")
    .select(BREAK_COLUMNS)
    .in("entry_id", entryIds)
    .order("break_start_at", { ascending: true });
  if (error) throw error;
  for (const row of data ?? []) {
    const b = mapBreak(row);
    const list = map.get(b.entry_id) ?? [];
    list.push(b);
    map.set(b.entry_id, list);
  }
  return map;
}

function mapEntryWithUser(row: {
  entry_id: string;
  user_id: string;
  location_id: string;
  clock_in_at: string;
  clock_out_at: string | null;
  notes: string | null;
  voided_at?: string | null;
  user?:
    | { first_name: string; last_name: string }
    | { first_name: string; last_name: string }[]
    | null;
}): TimeClockEntryWithUser {
  const user = Array.isArray(row.user) ? row.user[0] : row.user;
  return {
    entry_id: row.entry_id,
    user_id: row.user_id,
    location_id: row.location_id,
    clock_in_at: row.clock_in_at,
    clock_out_at: row.clock_out_at,
    notes: row.notes,
    voided_at: row.voided_at ?? null,
    first_name: user?.first_name ?? "",
    last_name: user?.last_name ?? "",
  };
}

export async function getOpenTimeClockEntry(
  userId?: string
): Promise<TimeClockEntry | null> {
  const user = await requireUser();
  const supabase = await createClient();
  const targetUserId = userId ?? user.user_id;

  const { data, error } = await supabase
    .from("time_clock_entry")
    .select(ENTRY_COLUMNS)
    .eq("user_id", targetUserId)
    .is("clock_out_at", null)
    .is("voided_at", null)
    .maybeSingle();

  if (error) throw error;
  return (data as TimeClockEntry) ?? null;
}

export async function getOpenBreakForEntry(
  entryId: string
): Promise<TimeClockBreak | null> {
  await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("time_clock_break")
    .select(BREAK_COLUMNS)
    .eq("entry_id", entryId)
    .is("break_end_at", null)
    .maybeSingle();
  if (error) throw error;
  return data ? mapBreak(data) : null;
}

export type ClockWidgetState = {
  openEntry: TimeClockEntry | null;
  openBreak: TimeClockBreak | null;
  mealBreakNudge: boolean;
};

export async function getClockWidgetState(userId?: string): Promise<ClockWidgetState> {
  const openEntry = await getOpenTimeClockEntry(userId);
  if (!openEntry) {
    return { openEntry: null, openBreak: null, mealBreakNudge: false };
  }
  const breaksMap = await loadBreaksForEntries([openEntry.entry_id]);
  const breaks = breaksMap.get(openEntry.entry_id) ?? [];
  const openBreak = breaks.find((b) => !b.break_end_at) ?? null;
  const forSummary: TimeClockBreakForSummary[] = breaks.map((b) => ({
    break_id: b.break_id,
    entry_id: b.entry_id,
    break_type: b.break_type,
    break_start_at: b.break_start_at,
    break_end_at: b.break_end_at,
  }));
  return {
    openEntry,
    openBreak,
    mealBreakNudge: shouldNudgeMealBreak(
      openEntry.clock_in_at,
      forSummary,
      openEntry.entry_id
    ),
  };
}

export async function clockIn(notes?: string | null): Promise<TimeClockEntry> {
  const user = await requireUser();
  if (!user.active_location_id) throw new Error("NO_LOCATION");

  const open = await getOpenTimeClockEntry(user.user_id);
  if (open) throw new Error("ALREADY_CLOCKED_IN");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("time_clock_entry")
    .insert({
      user_id: user.user_id,
      location_id: user.active_location_id,
      notes: notes?.trim() || null,
    })
    .select(ENTRY_COLUMNS)
    .single();

  if (error) throw error;
  const entry = data as TimeClockEntry;

  await addAuditLog(supabase, {
    actor_user_id: user.user_id,
    location_id: user.active_location_id,
    action: "time_clock_in",
    entity_type: "time_clock_entry",
    entity_id: entry.entry_id,
    description: `${user.first_name} ${user.last_name} clocked in`,
    new_value: entry,
  });

  return entry;
}

export async function clockOut(): Promise<TimeClockEntry> {
  const user = await requireUser();
  const open = await getOpenTimeClockEntry(user.user_id);
  if (!open) throw new Error("NOT_CLOCKED_IN");

  const openBreak = await getOpenBreakForEntry(open.entry_id);
  if (openBreak) {
    await endBreak();
  }

  try {
    const { endOpenJobTime } = await import("@/lib/services/jobTimeClock");
    await endOpenJobTime();
  } catch {
    // No open job timer — fine.
  }

  const supabase = await createClient();
  const clockOutAt = new Date().toISOString();
  const { data, error } = await supabase
    .from("time_clock_entry")
    .update({ clock_out_at: clockOutAt })
    .eq("entry_id", open.entry_id)
    .select(ENTRY_COLUMNS)
    .single();

  if (error) throw error;
  const entry = data as TimeClockEntry;

  await addAuditLog(supabase, {
    actor_user_id: user.user_id,
    location_id: user.active_location_id,
    action: "time_clock_out",
    entity_type: "time_clock_entry",
    entity_id: entry.entry_id,
    description: `${user.first_name} ${user.last_name} clocked out`,
    old_value: open,
    new_value: entry,
  });

  return entry;
}

async function requireClockStaffActor() {
  const user = await requireUser();
  if (!canClockStaff(user.role)) throw new Error("FORBIDDEN");
  if (!user.active_location_id) throw new Error("NO_LOCATION");
  return user;
}

async function loadFloorStaffForClock(userId: string): Promise<{
  user_id: string;
  first_name: string;
  last_name: string;
  role: UserRole;
  status: string;
}> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("app_user")
    .select("user_id, first_name, last_name, role, status")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!data || data.status !== "active" || !isFloorTech(data.role as UserRole)) {
    throw new Error("TECHNICIAN_NOT_FOUND");
  }
  return data as {
    user_id: string;
    first_name: string;
    last_name: string;
    role: UserRole;
    status: string;
  };
}

/** Owner / manager / service advisor clock a floor tech in at the active location. */
export async function clockStaffIn(staffUserId: string): Promise<TimeClockEntry> {
  const actor = await requireClockStaffActor();
  const staff = await loadFloorStaffForClock(staffUserId);

  const open = await getOpenTimeClockEntry(staff.user_id);
  if (open) throw new Error("ALREADY_CLOCKED_IN");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("time_clock_entry")
    .insert({
      user_id: staff.user_id,
      location_id: actor.active_location_id,
      notes: `Signed in by ${actor.first_name} ${actor.last_name}`,
    })
    .select(ENTRY_COLUMNS)
    .single();
  if (error) throw error;
  const entry = data as TimeClockEntry;

  await addAuditLog(supabase, {
    actor_user_id: actor.user_id,
    location_id: actor.active_location_id,
    action: "time_clock_staff_in",
    entity_type: "time_clock_entry",
    entity_id: entry.entry_id,
    description: `${actor.first_name} ${actor.last_name} signed in ${staff.first_name} ${staff.last_name}`,
    new_value: entry,
  });

  return entry;
}

/** Owner / manager / service advisor clock a floor tech out. */
export async function clockStaffOut(staffUserId: string): Promise<TimeClockEntry> {
  const actor = await requireClockStaffActor();
  const staff = await loadFloorStaffForClock(staffUserId);

  const open = await getOpenTimeClockEntry(staff.user_id);
  if (!open) throw new Error("NOT_CLOCKED_IN");

  const supabase = await createClient();

  const { data: openBreak } = await supabase
    .from("time_clock_break")
    .select(BREAK_COLUMNS)
    .eq("entry_id", open.entry_id)
    .is("break_end_at", null)
    .maybeSingle();
  if (openBreak) {
    await supabase
      .from("time_clock_break")
      .update({ break_end_at: new Date().toISOString() })
      .eq("break_id", openBreak.break_id);
  }

  const { data: openJob } = await supabase
    .from("job_time_entry")
    .select("job_time_entry_id")
    .eq("user_id", staff.user_id)
    .is("ended_at", null)
    .maybeSingle();
  if (openJob) {
    await supabase
      .from("job_time_entry")
      .update({ ended_at: new Date().toISOString() })
      .eq("job_time_entry_id", openJob.job_time_entry_id);
  }

  const clockOutAt = new Date().toISOString();
  const { data, error } = await supabase
    .from("time_clock_entry")
    .update({ clock_out_at: clockOutAt })
    .eq("entry_id", open.entry_id)
    .select(ENTRY_COLUMNS)
    .single();
  if (error) throw error;
  const entry = data as TimeClockEntry;

  await addAuditLog(supabase, {
    actor_user_id: actor.user_id,
    location_id: actor.active_location_id,
    action: "time_clock_staff_out",
    entity_type: "time_clock_entry",
    entity_id: entry.entry_id,
    description: `${actor.first_name} ${actor.last_name} signed out ${staff.first_name} ${staff.last_name}`,
    old_value: open,
    new_value: entry,
  });

  return entry;
}

export async function startBreak(
  breakType: "meal" | "other" = "meal"
): Promise<TimeClockBreak> {
  const user = await requireUser();
  const open = await getOpenTimeClockEntry(user.user_id);
  if (!open) throw new Error("NOT_CLOCKED_IN");

  const existing = await getOpenBreakForEntry(open.entry_id);
  if (existing) throw new Error("ALREADY_ON_BREAK");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("time_clock_break")
    .insert({
      entry_id: open.entry_id,
      break_type: breakType,
    })
    .select(BREAK_COLUMNS)
    .single();

  if (error) throw error;
  const row = mapBreak(data);

  await addAuditLog(supabase, {
    actor_user_id: user.user_id,
    location_id: user.active_location_id,
    action: "time_clock_break_start",
    entity_type: "time_clock_break",
    entity_id: row.break_id,
    description: `${user.first_name} ${user.last_name} started a ${breakType} break`,
    new_value: row,
  });

  return row;
}

export async function endBreak(): Promise<TimeClockBreak> {
  const user = await requireUser();
  const open = await getOpenTimeClockEntry(user.user_id);
  if (!open) throw new Error("NOT_CLOCKED_IN");

  const existing = await getOpenBreakForEntry(open.entry_id);
  if (!existing) throw new Error("NOT_ON_BREAK");

  const supabase = await createClient();
  const endAt = new Date().toISOString();
  const { data, error } = await supabase
    .from("time_clock_break")
    .update({ break_end_at: endAt })
    .eq("break_id", existing.break_id)
    .select(BREAK_COLUMNS)
    .single();

  if (error) throw error;
  const row = mapBreak(data);

  await addAuditLog(supabase, {
    actor_user_id: user.user_id,
    location_id: user.active_location_id,
    action: "time_clock_break_end",
    entity_type: "time_clock_break",
    entity_id: row.break_id,
    description: `${user.first_name} ${user.last_name} ended a break`,
    old_value: existing,
    new_value: row,
  });

  return row;
}

export async function listOpenTimeClockEntries(
  locationId?: string
): Promise<TimeClockEntryWithUser[]> {
  const user = await requireTimesheetManager();
  const supabase = await createClient();
  const loc = locationId ?? user.active_location_id;
  if (!loc) throw new Error("NO_LOCATION");

  const { data, error } = await supabase
    .from("time_clock_entry")
    .select(
      `
      ${ENTRY_COLUMNS},
      user:user_id (first_name, last_name)
    `
    )
    .eq("location_id", loc)
    .is("clock_out_at", null)
    .is("voided_at", null)
    .order("clock_in_at", { ascending: true });

  if (error) throw error;
  return (data ?? []).map((row) => mapEntryWithUser(row));
}

export async function listTimesheetStaff(): Promise<TimesheetStaffOption[]> {
  await requireTimesheetManager();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("app_user")
    .select("user_id, first_name, last_name, role")
    .eq("status", "active")
    .order("first_name", { ascending: true });

  if (error) throw error;
  return (data ?? []) as TimesheetStaffOption[];
}

async function loadTimesheetWeeks(
  locationId: string,
  weekStartDate: string,
  userIds?: string[]
): Promise<Map<string, TimesheetWeekRow>> {
  const supabase = await createClient();
  let query = supabase
    .from("timesheet_week")
    .select(WEEK_COLUMNS)
    .eq("location_id", locationId)
    .eq("week_start_date", weekStartDate);
  if (userIds && userIds.length > 0) {
    query = query.in("user_id", userIds);
  }
  const { data, error } = await query;
  if (error) throw error;
  const map = new Map<string, TimesheetWeekRow>();
  for (const row of data ?? []) {
    map.set(row.user_id, row as TimesheetWeekRow);
  }
  return map;
}

export type TimesheetWeekView = {
  range: ShopWeekRange;
  open: TimeClockEntryWithUser[];
  entries: TimeClockEntryWithUser[];
  summaries: UserWeekSummary[];
  weeksByUser: Record<string, TimesheetWeekRow>;
};

async function attachBreaksAndApprovals(
  entries: TimeClockEntryWithUser[],
  locationId: string,
  weekStartDate: string
): Promise<{
  entries: TimeClockEntryWithUser[];
  punches: PunchForSummary[];
  weeksByUser: Map<string, TimesheetWeekRow>;
}> {
  const breakMap = await loadBreaksForEntries(entries.map((e) => e.entry_id));
  const userIds = [...new Set(entries.map((e) => e.user_id))];
  const weeksByUser = await loadTimesheetWeeks(locationId, weekStartDate, userIds);

  const withBreaks = entries.map((e) => ({
    ...e,
    breaks: breakMap.get(e.entry_id) ?? [],
  }));

  const punches: PunchForSummary[] = withBreaks.map((e) => ({
    entry_id: e.entry_id,
    user_id: e.user_id,
    first_name: e.first_name,
    last_name: e.last_name,
    clock_in_at: e.clock_in_at,
    clock_out_at: e.clock_out_at,
    notes: e.notes,
    voided_at: e.voided_at,
    breaks: (e.breaks ?? []).map((b) => ({
      break_id: b.break_id,
      entry_id: b.entry_id,
      break_type: b.break_type,
      break_start_at: b.break_start_at,
      break_end_at: b.break_end_at,
    })),
    week_approval: weeksByUser.get(e.user_id)?.status ?? "open",
  }));

  return { entries: withBreaks, punches, weeksByUser };
}

export async function getTimesheetWeek(
  weekAnchor?: string | null
): Promise<TimesheetWeekView> {
  const user = await requireTimesheetManager();
  const supabase = await createClient();
  const loc = user.active_location_id;
  if (!loc) throw new Error("NO_LOCATION");

  let anchor: string | Date = new Date();
  if (weekAnchor?.trim()) {
    const key = weekAnchor.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(key)) {
      const parsed = parseShopLocalDateTimeInput(`${key}T12:00:00`);
      if (parsed) anchor = parsed;
    } else {
      anchor = key;
    }
  }

  const range = getShopWeekRange(anchor);
  const startIso = range.startUtc.toISOString();
  const endIso = range.endUtc.toISOString();

  const [weekRes, openRes] = await Promise.all([
    supabase
      .from("time_clock_entry")
      .select(
        `
        ${ENTRY_COLUMNS},
        user:user_id (first_name, last_name)
      `
      )
      .eq("location_id", loc)
      .is("voided_at", null)
      .gte("clock_in_at", startIso)
      .lt("clock_in_at", endIso)
      .order("clock_in_at", { ascending: true }),
    supabase
      .from("time_clock_entry")
      .select(
        `
        ${ENTRY_COLUMNS},
        user:user_id (first_name, last_name)
      `
      )
      .eq("location_id", loc)
      .is("clock_out_at", null)
      .is("voided_at", null)
      .order("clock_in_at", { ascending: true }),
  ]);

  if (weekRes.error) throw weekRes.error;
  if (openRes.error) throw openRes.error;

  const open = (openRes.data ?? []).map((row) => mapEntryWithUser(row));
  const weekEntries = (weekRes.data ?? []).map((row) => mapEntryWithUser(row));

  const byId = new Map<string, TimeClockEntryWithUser>();
  for (const entry of weekEntries) byId.set(entry.entry_id, entry);
  for (const entry of open) {
    if (!byId.has(entry.entry_id)) byId.set(entry.entry_id, entry);
  }
  const entriesRaw = [...byId.values()].sort((a, b) =>
    a.clock_in_at.localeCompare(b.clock_in_at)
  );

  const { entries, punches, weeksByUser } = await attachBreaksAndApprovals(
    entriesRaw,
    loc,
    range.startDateKey
  );

  const weeksRecord: Record<string, TimesheetWeekRow> = {};
  for (const [uid, row] of weeksByUser) weeksRecord[uid] = row;

  return {
    range,
    open,
    entries,
    summaries: summarizeWeek(punches, range),
    weeksByUser: weeksRecord,
  };
}

export type MyTimesheetWeekView = {
  range: ShopWeekRange;
  entries: TimeClockEntry[];
  summary: UserWeekSummary | null;
  week: TimesheetWeekRow | null;
};

export async function getMyTimesheetWeek(
  weekAnchor?: string | null
): Promise<MyTimesheetWeekView> {
  const user = await requireUser();
  const loc = user.active_location_id;
  if (!loc) throw new Error("NO_LOCATION");

  let anchor: string | Date = new Date();
  if (weekAnchor?.trim()) {
    const key = weekAnchor.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(key)) {
      const parsed = parseShopLocalDateTimeInput(`${key}T12:00:00`);
      if (parsed) anchor = parsed;
    } else {
      anchor = key;
    }
  }

  const range = getShopWeekRange(anchor);
  const supabase = await createClient();
  const startIso = range.startUtc.toISOString();
  const endIso = range.endUtc.toISOString();

  const [weekRes, openRes, weekRowRes] = await Promise.all([
    supabase
      .from("time_clock_entry")
      .select(ENTRY_COLUMNS)
      .eq("user_id", user.user_id)
      .is("voided_at", null)
      .gte("clock_in_at", startIso)
      .lt("clock_in_at", endIso)
      .order("clock_in_at", { ascending: true }),
    supabase
      .from("time_clock_entry")
      .select(ENTRY_COLUMNS)
      .eq("user_id", user.user_id)
      .is("clock_out_at", null)
      .is("voided_at", null)
      .maybeSingle(),
    supabase
      .from("timesheet_week")
      .select(WEEK_COLUMNS)
      .eq("user_id", user.user_id)
      .eq("location_id", loc)
      .eq("week_start_date", range.startDateKey)
      .maybeSingle(),
  ]);

  if (weekRes.error) throw weekRes.error;
  if (openRes.error) throw openRes.error;
  if (weekRowRes.error) throw weekRowRes.error;

  const byId = new Map<string, TimeClockEntry>();
  for (const row of weekRes.data ?? []) {
    byId.set(row.entry_id, row as TimeClockEntry);
  }
  if (openRes.data) {
    byId.set(openRes.data.entry_id, openRes.data as TimeClockEntry);
  }
  const entries = [...byId.values()].sort((a, b) =>
    a.clock_in_at.localeCompare(b.clock_in_at)
  );

  const breakMap = await loadBreaksForEntries(entries.map((e) => e.entry_id));
  const week = (weekRowRes.data as TimesheetWeekRow) ?? null;
  const punches: PunchForSummary[] = entries.map((e) => ({
    entry_id: e.entry_id,
    user_id: e.user_id,
    first_name: user.first_name,
    last_name: user.last_name,
    clock_in_at: e.clock_in_at,
    clock_out_at: e.clock_out_at,
    notes: e.notes,
    voided_at: e.voided_at,
    breaks: (breakMap.get(e.entry_id) ?? []).map((b) => ({
      break_id: b.break_id,
      entry_id: b.entry_id,
      break_type: b.break_type,
      break_start_at: b.break_start_at,
      break_end_at: b.break_end_at,
    })),
    week_approval: week?.status ?? "open",
  }));

  const summaries = summarizeWeek(punches, range);
  return {
    range,
    entries,
    summary: summaries[0] ?? null,
    week,
  };
}

export type MyShiftMonthView = {
  range: ShopMonthRange;
  entries: TimeClockEntry[];
  calendar: ShiftMonthCalendar;
};

export async function getMyShiftMonth(
  monthAnchor?: string | null
): Promise<MyShiftMonthView> {
  const user = await requireUser();
  const supabase = await createClient();

  let anchor: string | Date = new Date();
  if (monthAnchor?.trim()) {
    const key = monthAnchor.trim();
    if (/^\d{4}-\d{2}$/.test(key)) {
      anchor = key;
    } else if (/^\d{4}-\d{2}-\d{2}$/.test(key)) {
      const parsed = parseShopLocalDateTimeInput(`${key}T12:00:00`);
      if (parsed) anchor = parsed;
    } else {
      anchor = key;
    }
  }

  const range = getShopMonthRange(anchor);
  const queryStart = new Date(range.startUtc.getTime() - 24 * 60 * 60 * 1000);
  const startIso = queryStart.toISOString();
  const endIso = range.endUtc.toISOString();

  const [monthRes, openRes] = await Promise.all([
    supabase
      .from("time_clock_entry")
      .select(ENTRY_COLUMNS)
      .eq("user_id", user.user_id)
      .is("voided_at", null)
      .gte("clock_in_at", startIso)
      .lt("clock_in_at", endIso)
      .order("clock_in_at", { ascending: true }),
    supabase
      .from("time_clock_entry")
      .select(ENTRY_COLUMNS)
      .eq("user_id", user.user_id)
      .is("clock_out_at", null)
      .is("voided_at", null)
      .maybeSingle(),
  ]);

  if (monthRes.error) throw monthRes.error;
  if (openRes.error) throw openRes.error;

  const byId = new Map<string, TimeClockEntry>();
  for (const row of monthRes.data ?? []) {
    byId.set(row.entry_id, row as TimeClockEntry);
  }
  if (openRes.data) {
    const open = openRes.data as TimeClockEntry;
    byId.set(open.entry_id, open);
  }

  const entries = [...byId.values()].sort((a, b) =>
    a.clock_in_at.localeCompare(b.clock_in_at)
  );

  return {
    range,
    entries,
    calendar: buildShiftMonthCalendar(entries, range),
  };
}

export async function exportTimesheetWeekCsv(
  weekAnchor?: string | null
): Promise<{ filename: string; csv: string }> {
  const view = await getTimesheetWeek(weekAnchor);
  const punches: PunchForSummary[] = view.entries.map((e) => ({
    entry_id: e.entry_id,
    user_id: e.user_id,
    first_name: e.first_name,
    last_name: e.last_name,
    clock_in_at: e.clock_in_at,
    clock_out_at: e.clock_out_at,
    notes: e.notes,
    voided_at: e.voided_at,
    breaks: (e.breaks ?? []).map((b) => ({
      break_id: b.break_id,
      entry_id: b.entry_id,
      break_type: b.break_type,
      break_start_at: b.break_start_at,
      break_end_at: b.break_end_at,
    })),
    week_approval: view.weeksByUser[e.user_id]?.status ?? "open",
  }));
  const csv = buildTimesheetCsv(punches, Date.now(), view.summaries);
  const filename = `timesheets-${view.range.startDateKey}-to-${view.range.endDateKey}.csv`;
  return { filename, csv };
}

async function assertWeekNotApproved(
  userId: string,
  locationId: string,
  clockInAt: Date
): Promise<void> {
  const range = getShopWeekRange(clockInAt);
  const weeks = await loadTimesheetWeeks(locationId, range.startDateKey, [userId]);
  const week = weeks.get(userId);
  if (week?.status === "approved") {
    throw new Error("TIMESHEET_WEEK_LOCKED");
  }
}

function parsePunchTimes(input: { clock_in_at: string; clock_out_at?: string | null }): {
  clockIn: Date;
  clockOut: Date | null;
} {
  const clockIn = parseShopLocalDateTimeInput(input.clock_in_at);
  if (!clockIn) throw new Error("INVALID_CLOCK_IN");

  const rawOut = input.clock_out_at?.trim() || "";
  if (!rawOut) {
    return { clockIn, clockOut: null };
  }
  const clockOut = parseShopLocalDateTimeInput(rawOut);
  if (!clockOut) throw new Error("INVALID_CLOCK_OUT");
  if (clockOut.getTime() < clockIn.getTime()) {
    throw new Error("CLOCK_OUT_BEFORE_IN");
  }
  return { clockIn, clockOut };
}

export async function createTimeClockCorrection(input: {
  user_id: string;
  clock_in_at: string;
  clock_out_at?: string | null;
  notes?: string | null;
}): Promise<TimeClockEntry> {
  const actor = await requireTimesheetManager();
  const loc = actor.active_location_id;
  if (!loc) throw new Error("NO_LOCATION");

  const { clockIn, clockOut } = parsePunchTimes(input);
  if (!clockOut) throw new Error("CORRECTION_REQUIRES_CLOCK_OUT");
  await assertWeekNotApproved(input.user_id, loc, clockIn);

  const supabase = await createClient();
  const { data: staff, error: staffError } = await supabase
    .from("app_user")
    .select("user_id, first_name, last_name, status")
    .eq("user_id", input.user_id)
    .maybeSingle();
  if (staffError) throw staffError;
  if (!staff || staff.status !== "active") throw new Error("USER_NOT_FOUND");

  const { data, error } = await supabase
    .from("time_clock_entry")
    .insert({
      user_id: input.user_id,
      location_id: loc,
      clock_in_at: clockIn.toISOString(),
      clock_out_at: clockOut.toISOString(),
      notes: input.notes?.trim() || null,
    })
    .select(ENTRY_COLUMNS)
    .single();

  if (error) throw error;
  const entry = data as TimeClockEntry;

  await addAuditLog(supabase, {
    actor_user_id: actor.user_id,
    location_id: loc,
    action: "time_clock_correction_create",
    entity_type: "time_clock_entry",
    entity_id: entry.entry_id,
    description: `${actor.first_name} ${actor.last_name} added punch for ${staff.first_name} ${staff.last_name}`,
    new_value: entry,
  });

  return entry;
}

export async function updateTimeClockCorrection(input: {
  entry_id: string;
  clock_in_at: string;
  clock_out_at?: string | null;
  notes?: string | null;
}): Promise<TimeClockEntry> {
  const actor = await requireTimesheetManager();
  const loc = actor.active_location_id;
  if (!loc) throw new Error("NO_LOCATION");

  const { clockIn, clockOut } = parsePunchTimes(input);
  const supabase = await createClient();

  const { data: existing, error: existingError } = await supabase
    .from("time_clock_entry")
    .select(ENTRY_COLUMNS)
    .eq("entry_id", input.entry_id)
    .maybeSingle();
  if (existingError) throw existingError;
  if (!existing || existing.voided_at) throw new Error("TIME_CLOCK_ENTRY_NOT_FOUND");

  await assertWeekNotApproved(existing.user_id, loc, clockIn);

  if (!clockOut) {
    const open = await getOpenTimeClockEntry(existing.user_id);
    if (open && open.entry_id !== existing.entry_id) {
      throw new Error("ALREADY_CLOCKED_IN");
    }
  }

  const { data, error } = await supabase
    .from("time_clock_entry")
    .update({
      clock_in_at: clockIn.toISOString(),
      clock_out_at: clockOut ? clockOut.toISOString() : null,
      notes: input.notes?.trim() || null,
    })
    .eq("entry_id", input.entry_id)
    .select(ENTRY_COLUMNS)
    .single();

  if (error) throw error;
  const entry = data as TimeClockEntry;

  await addAuditLog(supabase, {
    actor_user_id: actor.user_id,
    location_id: loc,
    action: "time_clock_correction_update",
    entity_type: "time_clock_entry",
    entity_id: entry.entry_id,
    description: `${actor.first_name} ${actor.last_name} corrected a time clock punch`,
    old_value: existing,
    new_value: entry,
  });

  return entry;
}

/** Soft-void a punch (ESA retention). */
export async function deleteTimeClockCorrection(entryId: string): Promise<void> {
  const actor = await requireTimesheetManager();
  const loc = actor.active_location_id;
  if (!loc) throw new Error("NO_LOCATION");

  const supabase = await createClient();
  const { data: existing, error: existingError } = await supabase
    .from("time_clock_entry")
    .select(ENTRY_COLUMNS)
    .eq("entry_id", entryId)
    .maybeSingle();
  if (existingError) throw existingError;
  if (!existing || existing.voided_at) throw new Error("TIME_CLOCK_ENTRY_NOT_FOUND");

  await assertWeekNotApproved(existing.user_id, loc, new Date(existing.clock_in_at));

  const voidedAt = new Date().toISOString();
  const { error } = await supabase
    .from("time_clock_entry")
    .update({
      voided_at: voidedAt,
      clock_out_at: existing.clock_out_at ?? voidedAt,
    })
    .eq("entry_id", entryId);
  if (error) throw error;

  await addAuditLog(supabase, {
    actor_user_id: actor.user_id,
    location_id: loc,
    action: "time_clock_correction_void",
    entity_type: "time_clock_entry",
    entity_id: entryId,
    description: `${actor.first_name} ${actor.last_name} voided a time clock punch`,
    old_value: existing,
    new_value: { ...existing, voided_at: voidedAt },
  });
}

export async function createBreakCorrection(input: {
  entry_id: string;
  break_start_at: string;
  break_end_at: string;
  break_type?: "meal" | "other";
}): Promise<TimeClockBreak> {
  const actor = await requireTimesheetManager();
  const loc = actor.active_location_id;
  if (!loc) throw new Error("NO_LOCATION");

  const start = parseShopLocalDateTimeInput(input.break_start_at);
  const end = parseShopLocalDateTimeInput(input.break_end_at);
  if (!start) throw new Error("INVALID_BREAK_START");
  if (!end) throw new Error("INVALID_BREAK_END");
  if (end.getTime() <= start.getTime()) throw new Error("BREAK_END_BEFORE_START");

  const supabase = await createClient();
  const { data: entry, error: entryError } = await supabase
    .from("time_clock_entry")
    .select(ENTRY_COLUMNS)
    .eq("entry_id", input.entry_id)
    .maybeSingle();
  if (entryError) throw entryError;
  if (!entry || entry.voided_at) throw new Error("TIME_CLOCK_ENTRY_NOT_FOUND");

  await assertWeekNotApproved(entry.user_id, loc, new Date(entry.clock_in_at));

  const clockInMs = new Date(entry.clock_in_at).getTime();
  const clockOutMs = entry.clock_out_at
    ? new Date(entry.clock_out_at).getTime()
    : Number.POSITIVE_INFINITY;
  if (start.getTime() < clockInMs || end.getTime() > clockOutMs) {
    throw new Error("BREAK_OUTSIDE_PUNCH");
  }

  const { data, error } = await supabase
    .from("time_clock_break")
    .insert({
      entry_id: input.entry_id,
      break_type: input.break_type === "other" ? "other" : "meal",
      break_start_at: start.toISOString(),
      break_end_at: end.toISOString(),
    })
    .select(BREAK_COLUMNS)
    .single();
  if (error) throw error;
  const row = mapBreak(data);

  await addAuditLog(supabase, {
    actor_user_id: actor.user_id,
    location_id: loc,
    action: "time_clock_break_correction_create",
    entity_type: "time_clock_break",
    entity_id: row.break_id,
    description: `${actor.first_name} ${actor.last_name} added a break slot`,
    new_value: row,
  });

  return row;
}

export async function updateBreakCorrection(input: {
  break_id: string;
  break_start_at: string;
  break_end_at: string;
  break_type?: "meal" | "other";
}): Promise<TimeClockBreak> {
  const actor = await requireTimesheetManager();
  const loc = actor.active_location_id;
  if (!loc) throw new Error("NO_LOCATION");

  const start = parseShopLocalDateTimeInput(input.break_start_at);
  const end = parseShopLocalDateTimeInput(input.break_end_at);
  if (!start) throw new Error("INVALID_BREAK_START");
  if (!end) throw new Error("INVALID_BREAK_END");
  if (end.getTime() <= start.getTime()) throw new Error("BREAK_END_BEFORE_START");

  const supabase = await createClient();
  const { data: existing, error: existingError } = await supabase
    .from("time_clock_break")
    .select(BREAK_COLUMNS)
    .eq("break_id", input.break_id)
    .maybeSingle();
  if (existingError) throw existingError;
  if (!existing) throw new Error("BREAK_NOT_FOUND");

  const { data: entry, error: entryError } = await supabase
    .from("time_clock_entry")
    .select(ENTRY_COLUMNS)
    .eq("entry_id", existing.entry_id)
    .maybeSingle();
  if (entryError) throw entryError;
  if (!entry || entry.voided_at) throw new Error("TIME_CLOCK_ENTRY_NOT_FOUND");

  await assertWeekNotApproved(entry.user_id, loc, new Date(entry.clock_in_at));

  const { data, error } = await supabase
    .from("time_clock_break")
    .update({
      break_type: input.break_type === "other" ? "other" : "meal",
      break_start_at: start.toISOString(),
      break_end_at: end.toISOString(),
    })
    .eq("break_id", input.break_id)
    .select(BREAK_COLUMNS)
    .single();
  if (error) throw error;
  const row = mapBreak(data);

  await addAuditLog(supabase, {
    actor_user_id: actor.user_id,
    location_id: loc,
    action: "time_clock_break_correction_update",
    entity_type: "time_clock_break",
    entity_id: row.break_id,
    description: `${actor.first_name} ${actor.last_name} updated a break slot`,
    old_value: mapBreak(existing),
    new_value: row,
  });

  return row;
}

export async function deleteBreakCorrection(breakId: string): Promise<void> {
  const actor = await requireTimesheetManager();
  const loc = actor.active_location_id;
  if (!loc) throw new Error("NO_LOCATION");

  const supabase = await createClient();
  const { data: existing, error: existingError } = await supabase
    .from("time_clock_break")
    .select(BREAK_COLUMNS)
    .eq("break_id", breakId)
    .maybeSingle();
  if (existingError) throw existingError;
  if (!existing) throw new Error("BREAK_NOT_FOUND");

  const { data: entry, error: entryError } = await supabase
    .from("time_clock_entry")
    .select(ENTRY_COLUMNS)
    .eq("entry_id", existing.entry_id)
    .maybeSingle();
  if (entryError) throw entryError;
  if (!entry || entry.voided_at) throw new Error("TIME_CLOCK_ENTRY_NOT_FOUND");

  await assertWeekNotApproved(entry.user_id, loc, new Date(entry.clock_in_at));

  const { error } = await supabase
    .from("time_clock_break")
    .delete()
    .eq("break_id", breakId);
  if (error) throw error;

  await addAuditLog(supabase, {
    actor_user_id: actor.user_id,
    location_id: loc,
    action: "time_clock_break_correction_delete",
    entity_type: "time_clock_break",
    entity_id: breakId,
    description: `${actor.first_name} ${actor.last_name} deleted a break slot`,
    old_value: mapBreak(existing),
  });
}

async function upsertTimesheetWeekStatus(input: {
  userId: string;
  locationId: string;
  weekStartDate: string;
  status: TimesheetWeekStatus;
  actorUserId: string;
  note?: string | null;
}): Promise<TimesheetWeekRow> {
  const supabase = await createClient();
  const now = new Date().toISOString();
  const { data: existing, error: existingError } = await supabase
    .from("timesheet_week")
    .select(WEEK_COLUMNS)
    .eq("user_id", input.userId)
    .eq("location_id", input.locationId)
    .eq("week_start_date", input.weekStartDate)
    .maybeSingle();
  if (existingError) throw existingError;

  const patch: Record<string, unknown> = {
    status: input.status,
    updated_at: now,
    note: input.note?.trim() || null,
  };

  if (input.status === "submitted") {
    patch.submitted_at = now;
    patch.approved_by = null;
    patch.approved_at = null;
  } else if (input.status === "approved") {
    patch.approved_by = input.actorUserId;
    patch.approved_at = now;
  } else if (input.status === "rejected" || input.status === "open") {
    patch.approved_by = null;
    patch.approved_at = null;
    if (input.status === "open") {
      patch.submitted_at = null;
    }
  }

  if (existing) {
    const { data, error } = await supabase
      .from("timesheet_week")
      .update(patch)
      .eq("timesheet_week_id", existing.timesheet_week_id)
      .select(WEEK_COLUMNS)
      .single();
    if (error) throw error;
    return data as TimesheetWeekRow;
  }

  const { data, error } = await supabase
    .from("timesheet_week")
    .insert({
      user_id: input.userId,
      location_id: input.locationId,
      week_start_date: input.weekStartDate,
      ...patch,
    })
    .select(WEEK_COLUMNS)
    .single();
  if (error) throw error;
  return data as TimesheetWeekRow;
}

export async function submitMyTimesheetWeek(
  weekStartDate: string
): Promise<TimesheetWeekRow> {
  const user = await requireUser();
  const loc = user.active_location_id;
  if (!loc) throw new Error("NO_LOCATION");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStartDate)) {
    throw new Error("INVALID_WEEK");
  }

  const existing = (await loadTimesheetWeeks(loc, weekStartDate, [user.user_id])).get(
    user.user_id
  );
  if (existing?.status === "approved") throw new Error("TIMESHEET_WEEK_LOCKED");

  const row = await upsertTimesheetWeekStatus({
    userId: user.user_id,
    locationId: loc,
    weekStartDate,
    status: "submitted",
    actorUserId: user.user_id,
  });

  const supabase = await createClient();
  await addAuditLog(supabase, {
    actor_user_id: user.user_id,
    location_id: loc,
    action: "timesheet_week_submit",
    entity_type: "timesheet_week",
    entity_id: row.timesheet_week_id,
    description: `${user.first_name} ${user.last_name} submitted timesheet for ${weekStartDate}`,
    new_value: row,
  });

  return row;
}

export async function approveTimesheetWeek(input: {
  user_id: string;
  week_start_date: string;
  note?: string | null;
}): Promise<TimesheetWeekRow> {
  const actor = await requireTimesheetManager();
  const loc = actor.active_location_id;
  if (!loc) throw new Error("NO_LOCATION");

  const row = await upsertTimesheetWeekStatus({
    userId: input.user_id,
    locationId: loc,
    weekStartDate: input.week_start_date,
    status: "approved",
    actorUserId: actor.user_id,
    note: input.note,
  });

  const supabase = await createClient();
  await addAuditLog(supabase, {
    actor_user_id: actor.user_id,
    location_id: loc,
    action: "timesheet_week_approve",
    entity_type: "timesheet_week",
    entity_id: row.timesheet_week_id,
    description: `${actor.first_name} ${actor.last_name} approved timesheet`,
    new_value: row,
  });

  return row;
}

export async function rejectTimesheetWeek(input: {
  user_id: string;
  week_start_date: string;
  note?: string | null;
}): Promise<TimesheetWeekRow> {
  const actor = await requireTimesheetManager();
  const loc = actor.active_location_id;
  if (!loc) throw new Error("NO_LOCATION");

  const row = await upsertTimesheetWeekStatus({
    userId: input.user_id,
    locationId: loc,
    weekStartDate: input.week_start_date,
    status: "rejected",
    actorUserId: actor.user_id,
    note: input.note,
  });

  const supabase = await createClient();
  await addAuditLog(supabase, {
    actor_user_id: actor.user_id,
    location_id: loc,
    action: "timesheet_week_reject",
    entity_type: "timesheet_week",
    entity_id: row.timesheet_week_id,
    description: `${actor.first_name} ${actor.last_name} rejected timesheet`,
    new_value: row,
  });

  return row;
}

export async function reopenTimesheetWeek(input: {
  user_id: string;
  week_start_date: string;
  note?: string | null;
}): Promise<TimesheetWeekRow> {
  const actor = await requireTimesheetManager();
  const loc = actor.active_location_id;
  if (!loc) throw new Error("NO_LOCATION");

  const row = await upsertTimesheetWeekStatus({
    userId: input.user_id,
    locationId: loc,
    weekStartDate: input.week_start_date,
    status: "open",
    actorUserId: actor.user_id,
    note: input.note,
  });

  const supabase = await createClient();
  await addAuditLog(supabase, {
    actor_user_id: actor.user_id,
    location_id: loc,
    action: "timesheet_week_reopen",
    entity_type: "timesheet_week",
    entity_id: row.timesheet_week_id,
    description: `${actor.first_name} ${actor.last_name} reopened timesheet`,
    new_value: row,
  });

  return row;
}

export { formatElapsedMs, shopDateKey, getShopMonthRange };
export type { ShopWeekRange, ShopMonthRange, UserWeekSummary };
export type { ShiftMonthCalendar, ShiftCalendarDay };
