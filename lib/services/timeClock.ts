import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/database/supabase-server";
import { addAuditLog } from "@/lib/audit/addAuditLog";

export type TimeClockEntry = {
  entry_id: string;
  user_id: string;
  location_id: string;
  clock_in_at: string;
  clock_out_at: string | null;
  notes: string | null;
};

const COLUMNS =
  "entry_id, user_id, location_id, clock_in_at, clock_out_at, notes";

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
