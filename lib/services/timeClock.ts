import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/database/supabase-server";
import { addAuditLog } from "@/lib/audit/addAuditLog";
import { canManageTimesheets } from "@/lib/permissions";
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
  summarizeWeek,
  type PunchForSummary,
  type ShiftMonthCalendar,
  type ShiftCalendarDay,
  type UserWeekSummary,
} from "@/lib/services/timeClockShared";

export type TimeClockEntry = {
  entry_id: string;
  user_id: string;
  location_id: string;
  clock_in_at: string;
  clock_out_at: string | null;
  notes: string | null;
};

export type TimeClockEntryWithUser = TimeClockEntry & {
  first_name: string;
  last_name: string;
};

export type TimesheetStaffOption = {
  user_id: string;
  first_name: string;
  last_name: string;
  role: string;
};

const COLUMNS = "entry_id, user_id, location_id, clock_in_at, clock_out_at, notes";

async function requireTimesheetManager() {
  const user = await requireUser();
  if (!canManageTimesheets(user.role)) throw new Error("FORBIDDEN");
  return user;
}

export async function getOpenTimeClockEntry(
  userId?: string
): Promise<TimeClockEntry | null> {
  const user = await requireUser();
  const supabase = await createClient();
  const targetUserId = userId ?? user.user_id;

  const { data, error } = await supabase
    .from("time_clock_entry")
    .select(COLUMNS)
    .eq("user_id", targetUserId)
    .is("clock_out_at", null)
    .maybeSingle();

  if (error) throw error;
  return (data as TimeClockEntry) ?? null;
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
    .select(COLUMNS)
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

  const supabase = await createClient();
  const clockOutAt = new Date().toISOString();
  const { data, error } = await supabase
    .from("time_clock_entry")
    .update({ clock_out_at: clockOutAt })
    .eq("entry_id", open.entry_id)
    .select(COLUMNS)
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

function mapEntryWithUser(row: {
  entry_id: string;
  user_id: string;
  location_id: string;
  clock_in_at: string;
  clock_out_at: string | null;
  notes: string | null;
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
    first_name: user?.first_name ?? "",
    last_name: user?.last_name ?? "",
  };
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
      ${COLUMNS},
      user:user_id (first_name, last_name)
    `
    )
    .eq("location_id", loc)
    .is("clock_out_at", null)
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

export type TimesheetWeekView = {
  range: ShopWeekRange;
  open: TimeClockEntryWithUser[];
  entries: TimeClockEntryWithUser[];
  summaries: UserWeekSummary[];
};

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
        ${COLUMNS},
        user:user_id (first_name, last_name)
      `
      )
      .eq("location_id", loc)
      .gte("clock_in_at", startIso)
      .lt("clock_in_at", endIso)
      .order("clock_in_at", { ascending: true }),
    supabase
      .from("time_clock_entry")
      .select(
        `
        ${COLUMNS},
        user:user_id (first_name, last_name)
      `
      )
      .eq("location_id", loc)
      .is("clock_out_at", null)
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
  const entries = [...byId.values()].sort((a, b) =>
    a.clock_in_at.localeCompare(b.clock_in_at)
  );

  const punches: PunchForSummary[] = entries.map((e) => ({
    entry_id: e.entry_id,
    user_id: e.user_id,
    first_name: e.first_name,
    last_name: e.last_name,
    clock_in_at: e.clock_in_at,
    clock_out_at: e.clock_out_at,
    notes: e.notes,
  }));

  return {
    range,
    open,
    entries,
    summaries: summarizeWeek(punches, range),
  };
}

export type MyShiftMonthView = {
  range: ShopMonthRange;
  entries: TimeClockEntry[];
  calendar: ShiftMonthCalendar;
};

/**
 * Logged-in user's own punches for a shop calendar month (plus open punch if any).
 * Scoped to the current user only.
 */
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
  // Pull a day before month start so overnight punches that begin prior still appear.
  const queryStart = new Date(range.startUtc.getTime() - 24 * 60 * 60 * 1000);
  const startIso = queryStart.toISOString();
  const endIso = range.endUtc.toISOString();

  const [monthRes, openRes] = await Promise.all([
    supabase
      .from("time_clock_entry")
      .select(COLUMNS)
      .eq("user_id", user.user_id)
      .gte("clock_in_at", startIso)
      .lt("clock_in_at", endIso)
      .order("clock_in_at", { ascending: true }),
    supabase
      .from("time_clock_entry")
      .select(COLUMNS)
      .eq("user_id", user.user_id)
      .is("clock_out_at", null)
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
  }));
  const csv = buildTimesheetCsv(punches);
  const filename = `timesheets-${view.range.startDateKey}-to-${view.range.endDateKey}.csv`;
  return { filename, csv };
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
    .select(COLUMNS)
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
    .select(COLUMNS)
    .eq("entry_id", input.entry_id)
    .maybeSingle();
  if (existingError) throw existingError;
  if (!existing) throw new Error("TIME_CLOCK_ENTRY_NOT_FOUND");

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
    .select(COLUMNS)
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

export async function deleteTimeClockCorrection(entryId: string): Promise<void> {
  const actor = await requireTimesheetManager();
  const loc = actor.active_location_id;
  if (!loc) throw new Error("NO_LOCATION");

  const supabase = await createClient();
  const { data: existing, error: existingError } = await supabase
    .from("time_clock_entry")
    .select(COLUMNS)
    .eq("entry_id", entryId)
    .maybeSingle();
  if (existingError) throw existingError;
  if (!existing) throw new Error("TIME_CLOCK_ENTRY_NOT_FOUND");

  const { error } = await supabase
    .from("time_clock_entry")
    .delete()
    .eq("entry_id", entryId);
  if (error) throw error;

  await addAuditLog(supabase, {
    actor_user_id: actor.user_id,
    location_id: loc,
    action: "time_clock_correction_delete",
    entity_type: "time_clock_entry",
    entity_id: entryId,
    description: `${actor.first_name} ${actor.last_name} deleted a time clock punch`,
    old_value: existing,
  });
}

export { formatElapsedMs, shopDateKey, getShopMonthRange };
export type { ShopWeekRange, ShopMonthRange, UserWeekSummary };
export type { ShiftMonthCalendar, ShiftCalendarDay };
