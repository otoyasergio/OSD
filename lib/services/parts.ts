import { requireUser, type AppUser } from "@/lib/auth/session";
import { createClient } from "@/lib/database/supabase-server";
import type { DbClient, JobStatus, PartStatus } from "@/lib/database/types";
import { addAuditLog } from "@/lib/audit/addAuditLog";
import { addTimelineEvent } from "@/lib/timeline/addTimelineEvent";
import { TimelineEventType } from "@/lib/timeline/events";
import {
  canCompleteJob,
  canEditWorkOrder,
  canOrderPart,
} from "@/lib/permissions";
import { partSchema, partStatusSchema } from "@/lib/validation/schemas";
import { recalculateWorkOrderStatus } from "@/lib/status/recalculateWorkOrderStatus";

export type Part = {
  part_id: string;
  job_id: string;
  part_name: string;
  part_number: string | null;
  supplier: string | null;
  quantity: number;
  status: PartStatus;
  notes: string | null;
  created_by_user_id: string | null;
  ordered_at: string | null;
  installed_at: string | null;
  created_at: string;
  updated_at: string;
  job?: {
    job_id: string;
    work_order_id: string;
    service_name_snapshot: string;
    status: JobStatus;
    assigned_technician_id: string | null;
  } | null;
};

const ORDERABLE_JOB_STATUSES: JobStatus[] = [
  "approved",
  "waiting_for_parts",
  "ready_to_start",
  "in_progress",
];

const COLUMNS =
  "part_id, job_id, part_name, part_number, supplier, quantity, status, notes, created_by_user_id, ordered_at, installed_at, created_at, updated_at";

type JobRow = {
  job_id: string;
  work_order_id: string;
  service_name_snapshot: string;
  status: JobStatus;
  assigned_technician_id: string | null;
};

async function loadJob(supabase: DbClient, jobId: string): Promise<JobRow | null> {
  const { data, error } = await supabase
    .from("job")
    .select(
      "job_id, work_order_id, service_name_snapshot, status, assigned_technician_id"
    )
    .eq("job_id", jobId)
    .maybeSingle();
  if (error) throw error;
  return (data as JobRow) ?? null;
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
  if (
    workOrder.status === "completed" ||
    workOrder.status === "cancelled"
  ) {
    throw new Error("WORK_ORDER_LOCKED");
  }

  return {
    supabase,
    locationId: workOrder.location_id,
    workOrderNumber: workOrder.work_order_number,
  };
}

export async function listPartsForWorkOrder(
  workOrderId: string
): Promise<Part[]> {
  await requireUser();
  const supabase = await createClient();

  const { data: jobs, error: jobsError } = await supabase
    .from("job")
    .select("job_id")
    .eq("work_order_id", workOrderId);

  if (jobsError) throw jobsError;
  const jobIds = (jobs ?? []).map((j) => j.job_id);
  if (jobIds.length === 0) return [];

  const { data, error } = await supabase
    .from("part")
    .select(
      `
      ${COLUMNS},
      job:job_id (
        job_id,
        work_order_id,
        service_name_snapshot,
        status,
        assigned_technician_id
      )
    `
    )
    .in("job_id", jobIds)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data ?? []) as Part[];
}

export async function addPartToJob(
  jobId: string,
  input: {
    part_name: string;
    part_number?: string | null;
    supplier?: string | null;
    quantity?: number;
    notes?: string | null;
  }
): Promise<Part> {
  const user = await requireUser();
  if (!canOrderPart(user.role) && !canEditWorkOrder(user.role)) {
    throw new Error("FORBIDDEN");
  }

  const parsed = partSchema.parse(input);
  const supabase = await createClient();
  const job = await loadJob(supabase, jobId);
  if (!job) throw new Error("JOB_NOT_FOUND");

  const { locationId, workOrderNumber } = await requireMutableWorkOrder(
    user,
    job.work_order_id
  );

  const { data, error } = await supabase
    .from("part")
    .insert({
      job_id: jobId,
      part_name: parsed.part_name,
      part_number: parsed.part_number ?? null,
      supplier: parsed.supplier ?? null,
      quantity: parsed.quantity,
      notes: parsed.notes ?? null,
      status: "needed",
      created_by_user_id: user.user_id,
    })
    .select(COLUMNS)
    .single();

  if (error) throw error;
  const part = data as Part;

  await addTimelineEvent(supabase, {
    work_order_id: job.work_order_id,
    user_id: user.user_id,
    event_type: TimelineEventType.PART_ADDED,
    entity_type: "part",
    entity_id: part.part_id,
    description: `Part added: ${part.part_name} (${job.service_name_snapshot})`,
    new_value: { status: part.status, quantity: part.quantity },
  });

  await addAuditLog(supabase, {
    actor_user_id: user.user_id,
    location_id: locationId,
    action: "part_added",
    entity_type: "part",
    entity_id: part.part_id,
    description: `Part ${part.part_name} added on ${workOrderNumber}`,
    new_value: part,
  });

  await recalculateWorkOrderStatus(supabase, job.work_order_id, user.user_id);
  return part;
}

export async function updatePartStatus(
  partId: string,
  newStatus: PartStatus
): Promise<Part> {
  const user = await requireUser();
  const parsedStatus = partStatusSchema.parse(newStatus);

  const supabase = await createClient();
  const { data: existing, error: loadError } = await supabase
    .from("part")
    .select(COLUMNS)
    .eq("part_id", partId)
    .maybeSingle();

  if (loadError) throw loadError;
  if (!existing) throw new Error("PART_NOT_FOUND");

  const job = await loadJob(supabase, existing.job_id);
  if (!job) throw new Error("JOB_NOT_FOUND");

  const { locationId, workOrderNumber } = await requireMutableWorkOrder(
    user,
    job.work_order_id
  );

  if (parsedStatus === "ordered") {
    if (!canOrderPart(user.role)) throw new Error("FORBIDDEN");
    if (!ORDERABLE_JOB_STATUSES.includes(job.status)) {
      throw new Error("PARTS_ORDER_BEFORE_APPROVAL");
    }
  } else if (parsedStatus === "installed") {
    if (!canCompleteJob(user.role) && user.user_id !== job.assigned_technician_id) {
      throw new Error("FORBIDDEN");
    }
    if (!job.assigned_technician_id) {
      throw new Error("PART_INSTALL_REQUIRES_TECHNICIAN");
    }
  } else if (!canOrderPart(user.role) && !canEditWorkOrder(user.role)) {
    throw new Error("FORBIDDEN");
  }

  const now = new Date().toISOString();
  const patch: Record<string, unknown> = {
    status: parsedStatus,
    updated_at: now,
  };

  if (parsedStatus === "ordered" && !existing.ordered_at) {
    patch.ordered_at = now;
  }
  if (parsedStatus === "installed") {
    patch.installed_at = now;
  }

  const { data, error } = await supabase
    .from("part")
    .update(patch)
    .eq("part_id", partId)
    .select(COLUMNS)
    .single();

  if (error) throw error;
  const part = data as Part;

  await addTimelineEvent(supabase, {
    work_order_id: job.work_order_id,
    user_id: user.user_id,
    event_type: TimelineEventType.PART_STATUS_CHANGED,
    entity_type: "part",
    entity_id: partId,
    description: `Part ${part.part_name}: ${existing.status} → ${parsedStatus}`,
    old_value: { status: existing.status },
    new_value: { status: parsedStatus },
  });

  await addAuditLog(supabase, {
    actor_user_id: user.user_id,
    location_id: locationId,
    action: "part_status_changed",
    entity_type: "part",
    entity_id: partId,
    description: `Part status changed on ${workOrderNumber}`,
    old_value: { status: existing.status },
    new_value: { status: parsedStatus },
  });

  // Keep job status in sync when parts are waiting
  if (
    parsedStatus === "needed" ||
    parsedStatus === "ordered"
  ) {
    if (
      job.status === "approved" ||
      job.status === "ready_to_start"
    ) {
      await supabase
        .from("job")
        .update({ status: "waiting_for_parts", updated_at: now })
        .eq("job_id", job.job_id);
    }
  } else if (
    parsedStatus === "in_stock" ||
    parsedStatus === "installed" ||
    parsedStatus === "not_required" ||
    parsedStatus === "cancelled"
  ) {
    const { data: siblings } = await supabase
      .from("part")
      .select("status")
      .eq("job_id", job.job_id);

    const stillWaiting = (siblings ?? []).some(
      (p) => p.status === "needed" || p.status === "ordered"
    );
    if (!stillWaiting && job.status === "waiting_for_parts") {
      await supabase
        .from("job")
        .update({ status: "ready_to_start", updated_at: now })
        .eq("job_id", job.job_id);
    }
  }

  await recalculateWorkOrderStatus(supabase, job.work_order_id, user.user_id);
  return part;
}
