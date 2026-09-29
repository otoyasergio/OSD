import { requireUser, type AppUser } from "@/lib/auth/session";
import { createClient } from "@/lib/database/supabase-server";
import type { DbClient, TechnicianNoteType } from "@/lib/database/types";
import { addAuditLog } from "@/lib/audit/addAuditLog";
import { addTimelineEvent } from "@/lib/timeline/addTimelineEvent";
import { TimelineEventType } from "@/lib/timeline/events";
import { canCompleteJob, canCreateWorkOrder, canEditWorkOrder } from "@/lib/permissions";
import { technicianNoteSchema } from "@/lib/validation/schemas";
import {
  assertViewerCanAccessWorkOrder,
  assertViewerCanAccessWorkOrderLocation,
} from "@/lib/workOrders/assignmentVisibility";
import { TECHNICIAN_NOTE_TYPE_LABELS } from "@/lib/status/labels";
import { z } from "zod";

export type TechnicianNote = {
  technician_note_id: string;
  work_order_id: string;
  job_id: string | null;
  created_by_user_id: string | null;
  note: string;
  note_type: TechnicianNoteType;
  source_ai_message_id: string | null;
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
  "technician_note_id, work_order_id, job_id, created_by_user_id, source_ai_message_id, note, note_type, created_at";

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
  assertViewerCanAccessWorkOrderLocation(user, workOrder.location_id);
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

export type ReviewedNoteWorkOrder = {
  workOrderId: string;
  workOrderNumber: string;
  locationId: string;
  status: string;
  primaryTechnicianId: string | null;
  qualityCheckAssignedTo: string | null;
  jobs: Array<{ jobId: string; assignedTechnicianId: string | null }>;
};

export type ReviewedNoteSource = {
  messageId: string;
  workOrderId: string;
  jobId: string | null;
  role: string;
  generationStatus: string;
  audience: string;
  threadStatus: string;
};

type ReviewedNoteInsert = {
  workOrderId: string;
  jobId: string | null;
  createdByUserId: string;
  sourceAiMessageId: string;
  note: string;
  noteType: TechnicianNoteType;
};

export type ReviewedNotePromotionDependencies = {
  requireUser: () => Promise<AppUser>;
  loadWorkOrder: (workOrderId: string) => Promise<ReviewedNoteWorkOrder | null>;
  loadSourceMessage: (
    workOrderId: string,
    sourceMessageId: string
  ) => Promise<ReviewedNoteSource | null>;
  findExistingPromotion: (
    workOrderId: string,
    sourceMessageId: string
  ) => Promise<string | null>;
  insertNote: (input: ReviewedNoteInsert) => Promise<TechnicianNote>;
  recordTimeline: (input: {
    note: TechnicianNote;
    actor: AppUser;
    workOrder: ReviewedNoteWorkOrder;
  }) => Promise<void>;
  recordAudit: (input: {
    note: TechnicianNote;
    actor: AppUser;
    workOrder: ReviewedNoteWorkOrder;
  }) => Promise<void>;
};

const reviewedNotePromotionSchema = z
  .object({
    text: z.string().trim().min(1, "Note is required").max(8_000),
    noteType: z.enum([
      "general",
      "diagnostic_finding",
      "customer_concern_confirmed",
      "customer_concern_not_found",
      "parts_issue",
      "internal_warning",
    ]),
    jobId: z.string().uuid().nullable().optional(),
    sourceMessageId: z.string().uuid(),
  })
  .strict();

async function createDefaultReviewedNoteDependencies(): Promise<ReviewedNotePromotionDependencies> {
  const supabase = await createClient();
  return {
    requireUser,
    async loadWorkOrder(workOrderId) {
      const { data, error } = await supabase
        .from("work_order")
        .select(
          "work_order_id, work_order_number, location_id, status, primary_technician_id, quality_check_assigned_to, jobs:job(job_id, assigned_technician_id)"
        )
        .eq("work_order_id", workOrderId)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      return {
        workOrderId: data.work_order_id,
        workOrderNumber: data.work_order_number,
        locationId: data.location_id,
        status: data.status,
        primaryTechnicianId: data.primary_technician_id,
        qualityCheckAssignedTo: data.quality_check_assigned_to,
        jobs: (
          (data.jobs ?? []) as Array<{
            job_id: string;
            assigned_technician_id: string | null;
          }>
        ).map((job) => ({
          jobId: job.job_id,
          assignedTechnicianId: job.assigned_technician_id,
        })),
      };
    },
    async loadSourceMessage(workOrderId, sourceMessageId) {
      const { data, error } = await supabase
        .from("ai_assistant_message")
        .select(
          "ai_assistant_message_id, role, generation_status, thread:ai_assistant_thread!inner(work_order_id, job_id, audience, status)"
        )
        .eq("ai_assistant_message_id", sourceMessageId)
        .eq("thread.work_order_id", workOrderId)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      const thread = Array.isArray(data.thread) ? data.thread[0] : data.thread;
      if (!thread) return null;
      return {
        messageId: data.ai_assistant_message_id,
        workOrderId: thread.work_order_id,
        jobId: thread.job_id,
        role: data.role,
        generationStatus: data.generation_status,
        audience: thread.audience,
        threadStatus: thread.status,
      };
    },
    async findExistingPromotion(workOrderId, sourceMessageId) {
      const { data, error } = await supabase
        .from("technician_note")
        .select("technician_note_id")
        .eq("work_order_id", workOrderId)
        .eq("source_ai_message_id", sourceMessageId)
        .maybeSingle();
      if (error) throw error;
      return data?.technician_note_id ?? null;
    },
    async insertNote(input) {
      const { data, error } = await supabase
        .from("technician_note")
        .insert({
          work_order_id: input.workOrderId,
          job_id: input.jobId,
          created_by_user_id: input.createdByUserId,
          source_ai_message_id: input.sourceAiMessageId,
          note: input.note,
          note_type: input.noteType,
        })
        .select(COLUMNS)
        .single();
      if (error) {
        if (error.code === "23505") {
          throw new Error("ASK_OTOMOTO_NOTE_ALREADY_PROMOTED");
        }
        throw error;
      }
      return data as TechnicianNote;
    },
    async recordTimeline({ note, actor }) {
      const typeLabel = TECHNICIAN_NOTE_TYPE_LABELS[note.note_type] ?? note.note_type;
      await addTimelineEvent(supabase, {
        work_order_id: note.work_order_id,
        user_id: actor.user_id,
        event_type: TimelineEventType.TECHNICIAN_NOTE_ADDED,
        entity_type: "technician_note",
        entity_id: note.technician_note_id,
        description: `Reviewed Ask OTOMOTO note added (${typeLabel})`,
        new_value: {
          note_type: note.note_type,
          job_id: note.job_id,
          source_ai_message_id: note.source_ai_message_id,
          preview: note.note.slice(0, 120),
        },
      });
    },
    async recordAudit({ note, actor, workOrder }) {
      await addAuditLog(supabase, {
        actor_user_id: actor.user_id,
        location_id: workOrder.locationId,
        action: "ask_otomoto_note_promoted",
        entity_type: "technician_note",
        entity_id: note.technician_note_id,
        description: `Reviewed Ask OTOMOTO note added on ${workOrder.workOrderNumber}`,
        new_value: {
          note_type: note.note_type,
          job_id: note.job_id,
          source_ai_message_id: note.source_ai_message_id,
        },
      });
    },
  };
}

/**
 * Creates a new human-reviewed technician note. The assistant output is
 * provenance only: caller-provided edited text is always inserted as a new row.
 */
export async function promoteReviewedTechnicianNote(
  workOrderId: string,
  raw: z.input<typeof reviewedNotePromotionSchema>,
  injected?: ReviewedNotePromotionDependencies
): Promise<TechnicianNote> {
  const deps = injected ?? (await createDefaultReviewedNoteDependencies());
  const actor = await deps.requireUser();
  if (!canAddNotes(actor.role)) throw new Error("FORBIDDEN");
  const input = reviewedNotePromotionSchema.parse(raw);
  const workOrder = await deps.loadWorkOrder(z.string().uuid().parse(workOrderId));
  if (!workOrder) throw new Error("WORK_ORDER_NOT_FOUND");
  if (workOrder.locationId !== actor.active_location_id) {
    throw new Error("FOREIGN_LOCATION");
  }
  assertViewerCanAccessWorkOrderLocation(actor, workOrder.locationId);
  assertViewerCanAccessWorkOrder(
    {
      primary_technician_id: workOrder.primaryTechnicianId,
      quality_check_assigned_to: workOrder.qualityCheckAssignedTo,
      status: workOrder.status,
      jobs: workOrder.jobs.map((job) => ({
        assigned_technician_id: job.assignedTechnicianId,
      })),
    },
    actor.role,
    actor.user_id
  );
  if (workOrder.status === "completed" || workOrder.status === "cancelled") {
    throw new Error("WORK_ORDER_LOCKED");
  }
  if (input.jobId && !workOrder.jobs.some((job) => job.jobId === input.jobId)) {
    throw new Error("JOB_NOT_FOUND");
  }

  const source = await deps.loadSourceMessage(workOrderId, input.sourceMessageId);
  if (!source || source.workOrderId !== workOrderId) {
    throw new Error("ASK_OTOMOTO_NOTE_SOURCE_NOT_FOUND");
  }
  if (source.role !== "assistant") {
    throw new Error("ASK_OTOMOTO_NOTE_SOURCE_NOT_ASSISTANT");
  }
  if (source.generationStatus !== "ready") {
    throw new Error("ASK_OTOMOTO_NOTE_SOURCE_NOT_READY");
  }
  if (source.audience !== "technical") {
    throw new Error("ASK_OTOMOTO_NOTE_SOURCE_NOT_TECHNICAL");
  }
  if (source.threadStatus === "archived") {
    throw new Error("ASK_OTOMOTO_THREAD_ARCHIVED");
  }
  if (source.jobId && input.jobId !== source.jobId) {
    throw new Error("ASK_OTOMOTO_NOTE_JOB_MISMATCH");
  }
  if (await deps.findExistingPromotion(workOrderId, input.sourceMessageId)) {
    throw new Error("ASK_OTOMOTO_NOTE_ALREADY_PROMOTED");
  }

  const note = await deps.insertNote({
    workOrderId,
    jobId: input.jobId ?? null,
    createdByUserId: actor.user_id,
    sourceAiMessageId: input.sourceMessageId,
    note: input.text,
    noteType: input.noteType,
  });
  await Promise.allSettled([
    deps.recordTimeline({ note, actor, workOrder }),
    deps.recordAudit({ note, actor, workOrder }),
  ]);
  return note;
}
