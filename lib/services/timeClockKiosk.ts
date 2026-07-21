import { requireUser } from "@/lib/auth/session";
import { assertValidPin, hashPin, verifyPin } from "@/lib/auth/timeClockPin";
import { createClient } from "@/lib/database/supabase-server";
import type { UserRole } from "@/lib/database/types";
import { addAuditLog } from "@/lib/audit/addAuditLog";
import { canManageTimeClockPins, canUseTimeClockKiosk } from "@/lib/permissions";
import { getShopWeekRange } from "@/lib/datetime/format";
import {
  clockSubjectIn,
  clockSubjectOut,
  endSubjectBreak,
  getClockWidgetState,
  startSubjectBreak,
  type ClockWidgetState,
  type TimeClockBreak,
  type TimeClockEntry,
} from "@/lib/services/timeClock";
import {
  paidPunchDurationMs,
  shouldWarnSupervisorWeeklyHours,
  WEEKLY_HOURS_SUPERVISOR_WARNING_HOURS,
  type TimeClockBreakForSummary,
} from "@/lib/services/timeClockShared";

const PHOTO_BUCKET = "time-clock-photos";
const MAX_PHOTO_BYTES = 3 * 1024 * 1024;
const PUNCHABLE_ROLES: UserRole[] = ["technician", "head_tech", "service_advisor"];

const PIN_MAX_FAILS = 5;
const PIN_LOCK_MS = 60_000;

type PinAttemptState = { fails: number; lockedUntil: number };
const pinAttempts = new Map<string, PinAttemptState>();

export type KioskStaffRow = {
  user_id: string;
  first_name: string;
  last_name: string;
  role: UserRole;
  has_pin: boolean;
};

async function requireKiosk() {
  const user = await requireUser();
  if (!canUseTimeClockKiosk(user.role)) throw new Error("FORBIDDEN");
  if (!user.active_location_id) throw new Error("NO_LOCATION");
  return user;
}

function pinAttemptKey(actorUserId: string, staffUserId: string) {
  return `${actorUserId}:${staffUserId}`;
}

function assertNotRateLimited(key: string) {
  const state = pinAttempts.get(key);
  if (!state) return;
  if (state.lockedUntil > Date.now()) {
    throw new Error("PIN_LOCKED");
  }
}

function recordPinFailure(key: string) {
  const prev = pinAttempts.get(key) ?? { fails: 0, lockedUntil: 0 };
  const fails = prev.fails + 1;
  if (fails >= PIN_MAX_FAILS) {
    pinAttempts.set(key, { fails: 0, lockedUntil: Date.now() + PIN_LOCK_MS });
    throw new Error("PIN_LOCKED");
  }
  pinAttempts.set(key, { fails, lockedUntil: 0 });
}

function clearPinFailures(key: string) {
  pinAttempts.delete(key);
}

function decodePhotoBase64(photoBase64: string): Buffer {
  const trimmed = photoBase64.trim();
  if (!trimmed) throw new Error("PHOTO_REQUIRED");
  const dataUrl = trimmed.match(/^data:image\/(jpeg|jpg|png|webp);base64,(.+)$/i);
  const raw = dataUrl ? dataUrl[2] : trimmed;
  const bytes = Buffer.from(raw, "base64");
  if (bytes.length === 0) throw new Error("PHOTO_REQUIRED");
  if (bytes.length > MAX_PHOTO_BYTES) throw new Error("PHOTO_TOO_LARGE");
  return bytes;
}

async function uploadKioskPhoto(input: {
  locationId: string;
  userId: string;
  entityId: string;
  kind: "in" | "out" | "break_start" | "break_end";
  photoBase64: string;
}): Promise<string> {
  const bytes = decodePhotoBase64(input.photoBase64);
  const path = `${input.locationId}/${input.userId}/${input.entityId}/${input.kind}.jpg`;
  const supabase = await createClient();
  const { error } = await supabase.storage.from(PHOTO_BUCKET).upload(path, bytes, {
    contentType: "image/jpeg",
    upsert: true,
  });
  if (error) throw new Error("PHOTO_UPLOAD_FAILED");
  return path;
}

export async function listKioskStaff(): Promise<KioskStaffRow[]> {
  const kiosk = await requireKiosk();
  const supabase = await createClient();
  const locationId = kiosk.active_location_id!;

  const { data: memberships, error: memError } = await supabase
    .from("user_location")
    .select("user_id")
    .eq("location_id", locationId);
  if (memError) throw memError;

  const userIds = (memberships ?? []).map((m) => m.user_id);
  if (userIds.length === 0) return [];

  const { data, error } = await supabase
    .from("app_user")
    .select("user_id, first_name, last_name, role, status, time_clock_pin_hash")
    .in("user_id", userIds)
    .eq("status", "active")
    .in("role", PUNCHABLE_ROLES)
    .order("first_name", { ascending: true });
  if (error) throw error;

  return (data ?? []).map((row) => ({
    user_id: row.user_id,
    first_name: row.first_name,
    last_name: row.last_name,
    role: row.role as UserRole,
    has_pin: Boolean(row.time_clock_pin_hash),
  }));
}

export type KioskStaffSessionState = ClockWidgetState & {
  week_paid_hours: number;
  supervisor_hours_warning: boolean;
  supervisor_hours_message: string | null;
};

async function getStaffWeekPaidHours(
  staffUserId: string,
  locationId: string
): Promise<number> {
  const range = getShopWeekRange();
  const supabase = await createClient();
  const { data: entries, error } = await supabase
    .from("time_clock_entry")
    .select("entry_id, clock_in_at, clock_out_at, voided_at")
    .eq("user_id", staffUserId)
    .eq("location_id", locationId)
    .is("voided_at", null)
    .gte("clock_in_at", range.startUtc.toISOString())
    .lt("clock_in_at", range.endUtc.toISOString());
  if (error) throw error;

  const entryIds = (entries ?? []).map((e) => e.entry_id);
  const breaksByEntry = new Map<string, TimeClockBreakForSummary[]>();
  if (entryIds.length > 0) {
    const { data: breaks, error: bErr } = await supabase
      .from("time_clock_break")
      .select("break_id, entry_id, break_type, break_start_at, break_end_at")
      .in("entry_id", entryIds);
    if (bErr) throw bErr;
    for (const b of breaks ?? []) {
      const list = breaksByEntry.get(b.entry_id) ?? [];
      list.push({
        break_id: b.break_id,
        entry_id: b.entry_id,
        break_type: b.break_type,
        break_start_at: b.break_start_at,
        break_end_at: b.break_end_at,
      });
      breaksByEntry.set(b.entry_id, list);
    }
  }

  const nowMs = Date.now();
  let paidMs = 0;
  for (const entry of entries ?? []) {
    paidMs += paidPunchDurationMs(
      entry.clock_in_at,
      entry.clock_out_at,
      breaksByEntry.get(entry.entry_id) ?? [],
      entry.entry_id,
      nowMs
    );
  }
  return paidMs;
}

export async function getKioskStaffClockState(
  staffUserId: string
): Promise<KioskStaffSessionState> {
  const kiosk = await requireKiosk();
  const state = await getClockWidgetState(staffUserId);
  const weekPaidMs = await getStaffWeekPaidHours(staffUserId, kiosk.active_location_id!);
  const weekPaidHours = Math.round((weekPaidMs / 3_600_000) * 10) / 10;
  const warn = shouldWarnSupervisorWeeklyHours(weekPaidMs);
  return {
    ...state,
    week_paid_hours: weekPaidHours,
    supervisor_hours_warning: warn,
    supervisor_hours_message: warn
      ? `You are at ${weekPaidHours}h this week (warning at ${WEEKLY_HOURS_SUPERVISOR_WARNING_HOURS}h). Please let your supervisor know.`
      : null,
  };
}

export async function verifyStaffPin(
  staffUserId: string,
  pin: string
): Promise<{ ok: true; staff: KioskStaffRow & { role: UserRole } }> {
  const kiosk = await requireKiosk();
  const key = pinAttemptKey(kiosk.user_id, staffUserId);
  assertNotRateLimited(key);

  try {
    assertValidPin(pin);
  } catch {
    recordPinFailure(key);
    throw new Error("INVALID_PIN");
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("app_user")
    .select("user_id, first_name, last_name, role, status, time_clock_pin_hash")
    .eq("user_id", staffUserId)
    .maybeSingle();
  if (error) throw error;
  if (!data || data.status !== "active") {
    recordPinFailure(key);
    throw new Error("STAFF_NOT_FOUND");
  }
  if (!PUNCHABLE_ROLES.includes(data.role as UserRole)) {
    recordPinFailure(key);
    throw new Error("STAFF_NOT_FOUND");
  }
  if (!data.time_clock_pin_hash) {
    recordPinFailure(key);
    throw new Error("PIN_NOT_SET");
  }
  if (!verifyPin(pin, data.time_clock_pin_hash)) {
    recordPinFailure(key);
    throw new Error("INVALID_PIN");
  }

  clearPinFailures(key);
  return {
    ok: true,
    staff: {
      user_id: data.user_id,
      first_name: data.first_name,
      last_name: data.last_name,
      role: data.role as UserRole,
      has_pin: true,
    },
  };
}

async function requireVerifiedKioskStaff(staffUserId: string, pin: string) {
  const kiosk = await requireKiosk();
  const { staff } = await verifyStaffPin(staffUserId, pin);
  return { kiosk, staff };
}

export async function kioskClockIn(
  staffUserId: string,
  pin: string,
  photoBase64: string
): Promise<TimeClockEntry> {
  const { kiosk, staff } = await requireVerifiedKioskStaff(staffUserId, pin);
  const locationId = kiosk.active_location_id!;

  const entry = await clockSubjectIn({
    actorUserId: kiosk.user_id,
    subjectUserId: staff.user_id,
    locationId,
    notes: `Kiosk sign-in`,
    actor: kiosk,
    description: `Kiosk signed in ${staff.first_name} ${staff.last_name}`,
  });

  try {
    const photoPath = await uploadKioskPhoto({
      locationId,
      userId: staff.user_id,
      entityId: entry.entry_id,
      kind: "in",
      photoBase64,
    });

    const supabase = await createClient();
    const { data, error } = await supabase
      .from("time_clock_entry")
      .update({ clock_in_photo_path: photoPath })
      .eq("entry_id", entry.entry_id)
      .select(
        "entry_id, user_id, location_id, clock_in_at, clock_out_at, notes, voided_at, clock_in_photo_path, clock_out_photo_path"
      )
      .single();
    if (error) throw error;
    return data as TimeClockEntry;
  } catch (error) {
    const supabase = await createClient();
    await supabase
      .from("time_clock_entry")
      .update({
        voided_at: new Date().toISOString(),
        clock_out_at: new Date().toISOString(),
      })
      .eq("entry_id", entry.entry_id);
    throw error;
  }
}

export async function kioskClockOut(
  staffUserId: string,
  pin: string,
  photoBase64: string
): Promise<TimeClockEntry> {
  const { kiosk, staff } = await requireVerifiedKioskStaff(staffUserId, pin);
  const locationId = kiosk.active_location_id!;

  const openState = await getClockWidgetState(staff.user_id);
  if (!openState.openEntry) throw new Error("NOT_CLOCKED_IN");

  const photoPath = await uploadKioskPhoto({
    locationId,
    userId: staff.user_id,
    entityId: openState.openEntry.entry_id,
    kind: "out",
    photoBase64,
  });

  return clockSubjectOut({
    actorUserId: kiosk.user_id,
    subjectUserId: staff.user_id,
    photoPath,
    actor: kiosk,
    description: `Kiosk signed out ${staff.first_name} ${staff.last_name}`,
  });
}

export async function kioskStartMeal(
  staffUserId: string,
  pin: string,
  photoBase64: string
): Promise<TimeClockBreak> {
  const { kiosk, staff } = await requireVerifiedKioskStaff(staffUserId, pin);
  const locationId = kiosk.active_location_id!;

  const row = await startSubjectBreak({
    actorUserId: kiosk.user_id,
    subjectUserId: staff.user_id,
    breakType: "meal",
    actor: kiosk,
  });

  const photoPath = await uploadKioskPhoto({
    locationId,
    userId: staff.user_id,
    entityId: row.break_id,
    kind: "break_start",
    photoBase64,
  });

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("time_clock_break")
    .update({ break_start_photo_path: photoPath })
    .eq("break_id", row.break_id)
    .select(
      "break_id, entry_id, break_type, break_start_at, break_end_at, break_start_photo_path, break_end_photo_path"
    )
    .single();
  if (error) throw error;
  return {
    break_id: data.break_id,
    entry_id: data.entry_id,
    break_type: data.break_type === "other" ? "other" : "meal",
    break_start_at: data.break_start_at,
    break_end_at: data.break_end_at,
    break_start_photo_path: data.break_start_photo_path ?? null,
    break_end_photo_path: data.break_end_photo_path ?? null,
  };
}

export async function kioskEndMeal(
  staffUserId: string,
  pin: string,
  photoBase64: string
): Promise<TimeClockBreak> {
  const { kiosk, staff } = await requireVerifiedKioskStaff(staffUserId, pin);
  const locationId = kiosk.active_location_id!;

  const openState = await getClockWidgetState(staff.user_id);
  if (!openState.openBreak) throw new Error("NOT_ON_BREAK");

  const photoPath = await uploadKioskPhoto({
    locationId,
    userId: staff.user_id,
    entityId: openState.openBreak.break_id,
    kind: "break_end",
    photoBase64,
  });

  return endSubjectBreak({
    actorUserId: kiosk.user_id,
    subjectUserId: staff.user_id,
    photoPath,
    actor: kiosk,
  });
}

async function assertPinUniqueAmongActive(pin: string, excludeUserId?: string) {
  const supabase = await createClient();
  let query = supabase
    .from("app_user")
    .select("user_id, time_clock_pin_hash")
    .eq("status", "active")
    .not("time_clock_pin_hash", "is", null);
  if (excludeUserId) {
    query = query.neq("user_id", excludeUserId);
  }
  const { data, error } = await query;
  if (error) throw error;
  for (const row of data ?? []) {
    if (row.time_clock_pin_hash && verifyPin(pin, row.time_clock_pin_hash)) {
      throw new Error("PIN_ALREADY_IN_USE");
    }
  }
}

export async function setStaffTimeClockPin(userId: string, pin: string): Promise<void> {
  const actor = await requireUser();
  if (!canManageTimeClockPins(actor.role)) throw new Error("FORBIDDEN");

  assertValidPin(pin);
  await assertPinUniqueAmongActive(pin, userId);

  const supabase = await createClient();
  const { data: staff, error: staffError } = await supabase
    .from("app_user")
    .select("user_id, first_name, last_name, status")
    .eq("user_id", userId)
    .maybeSingle();
  if (staffError) throw staffError;
  if (!staff || staff.status !== "active") throw new Error("USER_NOT_FOUND");

  const pinHash = hashPin(pin);
  const { error } = await supabase.rpc("set_app_user_time_clock_pin", {
    p_user_id: userId,
    p_pin_hash: pinHash,
  });
  if (error) throw error;

  await addAuditLog(supabase, {
    actor_user_id: actor.user_id,
    location_id: actor.active_location_id,
    action: "time_clock_pin_set",
    entity_type: "app_user",
    entity_id: userId,
    description: `${actor.first_name} ${actor.last_name} set time clock PIN for ${staff.first_name} ${staff.last_name}`,
  });
}

export async function clearStaffTimeClockPin(userId: string): Promise<void> {
  const actor = await requireUser();
  if (!canManageTimeClockPins(actor.role)) throw new Error("FORBIDDEN");

  const supabase = await createClient();
  const { data: staff, error: staffError } = await supabase
    .from("app_user")
    .select("user_id, first_name, last_name")
    .eq("user_id", userId)
    .maybeSingle();
  if (staffError) throw staffError;
  if (!staff) throw new Error("USER_NOT_FOUND");

  const { error } = await supabase.rpc("set_app_user_time_clock_pin", {
    p_user_id: userId,
    p_pin_hash: null,
  });
  if (error) throw error;

  await addAuditLog(supabase, {
    actor_user_id: actor.user_id,
    location_id: actor.active_location_id,
    action: "time_clock_pin_clear",
    entity_type: "app_user",
    entity_id: userId,
    description: `${actor.first_name} ${actor.last_name} cleared time clock PIN for ${staff.first_name} ${staff.last_name}`,
  });
}
