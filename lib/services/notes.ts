import { requireUser, type AppUser } from "@/lib/auth/session";
import { createClient } from "@/lib/database/supabase-server";
import type { DbClient, TechnicianNoteType } from "@/lib/database/types";
import { addAuditLog } from "@/lib/audit/addAuditLog";
import { addTimelineEvent } from "@/lib/timeline/addTimelineEvent";
import { TimelineEventType } from "@/lib/timeline/events";
import { canCompleteJob, canCreateWorkOrder, canEditWorkOrder } from "@/lib/permissions";
import { technicianNoteSchema } from "@/lib/validation/schemas";
import { TECHNICIAN_NOTE_TYPE_LABELS } from "@/lib/status/labels";

export type TechnicianNote = {
  technician_note_id: string;
  work_order_id: string;
  job_id: string | null;
  created_by_user_id: string | null;
  note: string;
  note_type: TechnicianNoteType;
  created_at: string;
  created_by?: {
    user_id: string;
    first_name: string;
    last_name: string;
  } | null;
  job?: {
    job_id: string;
    service_name_snapshot: string;
  } | null;
};

const COLUMNS =
  "technician_note_id, work_order_id, job_id, created_by_user_id, note, note_type, created_at";

function canAddNotes(role: AppUser["role"]) {
  return canCompleteJob(role) || canEditWorkOrder(role) || canCreateWorkOrder(role);
}

async function requireMutableWorkOrder(
  user: AppUser,
  workOrderId: string
): Promise<{
  supabase: DbClient;
  locationId: string;
  workOrderNumber: string;
}> {
  const supabase = await createClient();
  const { data: workOrder, error } = await supabase
    .from("work_order")
    .select("work_order_id, location_id, work_order_number, status")
    .eq("work_order_id", workOrderId)
    .maybeSingle();

  if (error) throw error;
  if (!workOrder) throw new Error("WORK_ORDER_NOT_FOUND");
  if (workOrder.location_id !== user.active_location_id) {
    throw new Error("FOREIGN_LOCATION");
  }
  if (workOrder.status === "completed" || workOrder.status === "cancelled") {
    throw new Error("WORK_ORDER_LOCKED");
  }

  return {
    supabase,
    locationId: workOrder.location_id,
    workOrderNumber: workOrder.work_order_number,
  };
}

/**
 * Ordering contract: technician notes are returned NEWEST FIRST
 * (created_at descending). To preview the latest N notes take them from the
 * FRONT of the list (or use latestTechnicianNotes) — `slice(-N)` on this
 * list returns the oldest notes.
 */
export function latestTechnicianNotes<T extends { created_at: string }>(
  notes: T[],
  limit: number
): T[] {
  if (limit <= 0) return [];
  return [...notes]
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, limit);
}

/** Technician notes for a work order (optionally one job), newest first. */
export async function listTechnicianNotes(
  workOrderId: string,
  jobId?: string | null
): Promise<TechnicianNote[]> {
  await requireUser();
  const supabase = await createClient();

  let query = supabase
    .from("technician_note")
    .select(
      `
      ${COLUMNS},
      created_by:created_by_user_id (
        user_id,
        first_name,
        last_name
      ),
      job:job_id (
        job_id,
        service_name_snapshot
      )
    `
    )
    .eq("work_order_id", workOrderId)
    .order("created_at", { ascending: false });

  if (jobId) {
    query = query.eq("job_id", jobId);
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as unknown as TechnicianNote[];
}

export async function addTechnicianNote(
  workOrderId: string,
  input: {
    note: string;
    note_type?: TechnicianNoteType;
    job_id?: string | null;
  }
): Promise<TechnicianNote> {
  const user = await requireUser();
  if (!canAddNotes(user.role)) throw new Error("FORBIDDEN");

  const parsed = technicianNoteSchema.parse({
    note: input.note,
    note_type: input.note_type ?? "general",
    job_id: input.job_id ?? null,
  });

  if (!parsed.note.trim()) throw new Error("NOTE_REQUIRED");

  const { supabase, locationId, workOrderNumber } = await requireMutableWorkOrder(
    user,
    workOrderId
  );

  if (parsed.job_id) {
    const { data: job, error: jobError } = await supabase
      .from("job")
      .select("job_id, work_order_id")
      .eq("job_id", parsed.job_id)
      .maybeSingle();
    if (jobError) throw jobError;
    if (!job || job.work_order_id !== workOrderId) {
      throw new Error("JOB_NOT_FOUND");
    }
  }

  const { data, error } = await supabase
    .from("technician_note")
    .insert({
      work_order_id: workOrderId,
      job_id: parsed.job_id ?? null,
      created_by_user_id: user.user_id,
      note: parsed.note.trim(),
      note_type: parsed.note_type,
    })
    .select(COLUMNS)
    .single();

  if (error) throw error;
  const note = data as TechnicianNote;
  const typeLabel = TECHNICIAN_NOTE_TYPE_LABELS[note.note_type] ?? note.note_type;

  await addTimelineEvent(supabase, {
    work_order_id: workOrderId,
    user_id: user.user_id,
    event_type: TimelineEventType.TECHNICIAN_NOTE_ADDED,
    entity_type: "technician_note",
    entity_id: note.technician_note_id,
    description: `Technician note added (${typeLabel})`,
    new_value: {
      note_type: note.note_type,
      job_id: note.job_id,
      preview: note.note.slice(0, 120),
    },
  });

  await addAuditLog(supabase, {
    actor_user_id: user.user_id,
    location_id: locationId,
    action: "technician_note_added",
    entity_type: "technician_note",
    entity_id: note.technician_note_id,
    description: `Technician note added on ${workOrderNumber}`,
    new_value: {
      note_type: note.note_type,
      job_id: note.job_id,
    },
  });

  return note;
}
