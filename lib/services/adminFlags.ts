import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/database/supabase-server";
import type { AdminFlagReason, DbClient } from "@/lib/database/types";
import { addAuditLog } from "@/lib/audit/addAuditLog";
import { addTimelineEvent } from "@/lib/timeline/addTimelineEvent";
import { TimelineEventType } from "@/lib/timeline/events";
import { canClearAdminFlag, canCreateAdminFlag, isFloorTech } from "@/lib/permissions";
import { recalculateWorkOrderStatus } from "@/lib/status/recalculateWorkOrderStatus";

export type AdminFlag = {
  admin_flag_id: string;
  work_order_id: string;
  job_id: string | null;
  reason: AdminFlagReason;
  note: string | null;
  created_by_user_id: string | null;
  created_at: string;
  cleared_at: string | null;
  cleared_by_user_id: string | null;
};

const REASONS = new Set<AdminFlagReason>([
  "parts",
  "approval",
  "tool",
  "quality",
  "other",
]);

export async function listOpenAdminFlagsForWorkOrders(
  supabase: DbClient,
  workOrderIds: string[]
): Promise<Map<string, AdminFlag[]>> {
  const map = new Map<string, AdminFlag[]>();
  if (workOrderIds.length === 0) return map;

  const { data, error } = await supabase
    .from("admin_flag")
    .select(
      "admin_flag_id, work_order_id, job_id, reason, note, created_by_user_id, created_at, cleared_at, cleared_by_user_id"
    )
    .in("work_order_id", workOrderIds)
    .is("cleared_at", null);
  if (error) throw error;

  for (const row of (data as AdminFlag[]) ?? []) {
    const list = map.get(row.work_order_id) ?? [];
    list.push(row);
    map.set(row.work_order_id, list);
  }
  return map;
}

export async function createAdminFlag(input: {
  workOrderId: string;
  jobId?: string | null;
  reason: AdminFlagReason;
  note?: string | null;
  /** When true and job is in_progress, stop timer and return to ready_to_start. */
  stopActiveJob?: boolean;
}): Promise<{ admin_flag_id: string }> {
  const user = await requireUser();
  if (!canCreateAdminFlag(user.role)) throw new Error("FORBIDDEN");
  if (!REASONS.has(input.reason)) throw new Error("INVALID_FLAG_REASON");

  const supabase = await createClient();
  const { data: workOrder, error: woError } = await supabase
    .from("work_order")
    .select("work_order_id, location_id, work_order_number, status")
    .eq("work_order_id", input.workOrderId)
    .maybeSingle();
  if (woError) throw woError;
  if (!workOrder) throw new Error("WORK_ORDER_NOT_FOUND");
  if (workOrder.location_id !== user.active_location_id) {
    throw new Error("FOREIGN_LOCATION");
  }
  if (workOrder.status === "completed" || workOrder.status === "cancelled") {
    throw new Error("WORK_ORDER_LOCKED");
  }

  const note = input.note?.trim() || null;
  const { data: flag, error } = await supabase
    .from("admin_flag")
    .insert({
      work_order_id: input.workOrderId,
      job_id: input.jobId ?? null,
      reason: input.reason,
      note,
      created_by_user_id: user.user_id,
    })
    .select("admin_flag_id")
    .single();
  if (error) throw error;

  if (input.stopActiveJob && input.jobId) {
    const { data: job } = await supabase
      .from("job")
      .select("status, assigned_technician_id, notes, service_name_snapshot")
      .eq("job_id", input.jobId)
      .maybeSingle();
    if (
      job?.status === "in_progress" &&
      (!isFloorTech(user.role) || job.assigned_technician_id === user.user_id)
    ) {
      const now = new Date().toISOString();
      const flagNote = `Flagged for admin (${input.reason})`;
      const { error: jobError } = await supabase
        .from("job")
        .update({
          status: "ready_to_start",
          notes: [job.notes, flagNote].filter(Boolean).join("\n"),
          updated_at: now,
        })
        .eq("job_id", input.jobId);
      if (jobError) throw jobError;

      await addTimelineEvent(supabase, {
        work_order_id: input.workOrderId,
        user_id: user.user_id,
        event_type: TimelineEventType.JOB_STATUS_CHANGED,
        entity_type: "job",
        entity_id: input.jobId,
        description: `Job paused for admin flag: ${job.service_name_snapshot}`,
        old_value: { status: "in_progress" },
        new_value: { status: "ready_to_start" },
      });

      await recalculateWorkOrderStatus(supabase, input.workOrderId, user.user_id);
    }
  }

  await addTimelineEvent(supabase, {
    work_order_id: input.workOrderId,
    user_id: user.user_id,
    event_type: TimelineEventType.TECHNICIAN_NOTE_ADDED,
    entity_type: "admin_flag",
    entity_id: flag.admin_flag_id,
    description: `Admin flag raised: ${input.reason}${note ? ` — ${note}` : ""}`,
    new_value: { reason: input.reason, job_id: input.jobId ?? null },
  });

  await addAuditLog(supabase, {
    actor_user_id: user.user_id,
    location_id: workOrder.location_id,
    action: "admin_flag_created",
    entity_type: "admin_flag",
    entity_id: flag.admin_flag_id,
    description: `Admin flag on ${workOrder.work_order_number}: ${input.reason}`,
    new_value: { reason: input.reason, note },
  });

  return { admin_flag_id: flag.admin_flag_id };
}

export async function clearAdminFlag(adminFlagId: string): Promise<void> {
  const user = await requireUser();
  if (!canClearAdminFlag(user.role)) throw new Error("FORBIDDEN");

  const supabase = await createClient();
  const { data: flag, error: loadError } = await supabase
    .from("admin_flag")
    .select("admin_flag_id, work_order_id, cleared_at, reason")
    .eq("admin_flag_id", adminFlagId)
    .maybeSingle();
  if (loadError) throw loadError;
  if (!flag) throw new Error("ADMIN_FLAG_NOT_FOUND");
  if (flag.cleared_at) throw new Error("ADMIN_FLAG_ALREADY_CLEARED");

  const { data: workOrder, error: woError } = await supabase
    .from("work_order")
    .select("location_id, work_order_number")
    .eq("work_order_id", flag.work_order_id)
    .maybeSingle();
  if (woError) throw woError;
  if (!workOrder) throw new Error("WORK_ORDER_NOT_FOUND");
  if (workOrder.location_id !== user.active_location_id) {
    throw new Error("FOREIGN_LOCATION");
  }

  const now = new Date().toISOString();
  const { error } = await supabase
    .from("admin_flag")
    .update({
      cleared_at: now,
      cleared_by_user_id: user.user_id,
    })
    .eq("admin_flag_id", adminFlagId);
  if (error) throw error;

  await addAuditLog(supabase, {
    actor_user_id: user.user_id,
    location_id: workOrder.location_id,
    action: "admin_flag_cleared",
    entity_type: "admin_flag",
    entity_id: adminFlagId,
    description: `Cleared admin flag on ${workOrder.work_order_number}`,
    old_value: { reason: flag.reason },
  });
}
