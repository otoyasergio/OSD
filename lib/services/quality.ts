import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/database/supabase-server";
import type { DbClient, WorkOrderStatus } from "@/lib/database/types";
import { addAuditLog } from "@/lib/audit/addAuditLog";
import { addTimelineEvent } from "@/lib/timeline/addTimelineEvent";
import { TimelineEventType } from "@/lib/timeline/events";
import {
  canCompleteWorkOrder,
  canMarkReadyForPickup,
  canOverrideWorkOrderStatus,
  canRunQualityCheck,
  isFloorTech,
} from "@/lib/permissions";
import { assertViewerCanAccessWorkOrderLocation } from "@/lib/workOrders/assignmentVisibility";
import { recalculateWorkOrderStatus } from "@/lib/status/recalculateWorkOrderStatus";
import { pickupLeaveBlockReason } from "@/lib/status/pickupGates";
import { isSafetyRequired } from "@/lib/status/safetyRequired";

type WorkOrderRow = {
  work_order_id: string;
  location_id: string;
  status: WorkOrderStatus;
  quality_checked_at: string | null;
  quality_checked_by_user_id: string | null;
  ready_for_pickup_at: string | null;
};

async function loadWorkOrder(
  supabase: DbClient,
  workOrderId: string
): Promise<WorkOrderRow | null> {
  const { data, error } = await supabase
    .from("work_order")
    .select(
      "work_order_id, location_id, status, quality_checked_at, quality_checked_by_user_id, ready_for_pickup_at"
    )
    .eq("work_order_id", workOrderId)
    .maybeSingle();
  if (error) throw error;
  return (data as WorkOrderRow) ?? null;
}

async function requireMutableWorkOrder(workOrderId: string) {
  const user = await requireUser();
  const supabase = await createClient();
  const workOrder = await loadWorkOrder(supabase, workOrderId);
  if (!workOrder) throw new Error("WORK_ORDER_NOT_FOUND");
  assertViewerCanAccessWorkOrderLocation(user, workOrder.location_id);
  if (workOrder.status === "completed" || workOrder.status === "cancelled") {
    throw new Error("WORK_ORDER_LOCKED");
  }
  return { user, supabase, workOrder };
}

function isActiveJob(status: string) {
  return status !== "cancelled" && status !== "declined";
}

async function assertAllActiveJobsCompleted(supabase: DbClient, workOrderId: string) {
  const { data: jobs, error } = await supabase
    .from("job")
    .select("job_id, status")
    .eq("work_order_id", workOrderId);
  if (error) throw error;

  const active = (jobs ?? []).filter((job: { status: string }) =>
    isActiveJob(job.status)
  );
  if (active.length === 0) {
    throw new Error("NO_ACTIVE_JOBS");
  }
  if (active.some((job: { status: string }) => job.status !== "completed")) {
    throw new Error("JOBS_NOT_COMPLETE");
  }
}

async function assertPickupLeaveGates(
  supabase: DbClient,
  workOrderId: string,
  workOrder: Pick<WorkOrderRow, "quality_checked_at" | "quality_checked_by_user_id">
) {
  const [
    { data: safetyRow, error: safetyError },
    { data: jobs, error: jobsError },
    { data: inspection, error: inspectionError },
  ] = await Promise.all([
    supabase
      .from("work_order")
      .select(
        "safety_checked_at, safety_checked_by_user_id, safety_required, safety_waived"
      )
      .eq("work_order_id", workOrderId)
      .single(),
    supabase
      .from("job")
      .select("status, service_name_snapshot")
      .eq("work_order_id", workOrderId),
    supabase
      .from("inspection")
      .select("completed_at")
      .eq("work_order_id", workOrderId)
      .maybeSingle(),
  ]);
  if (safetyError) throw safetyError;
  if (jobsError) throw jobsError;
  if (inspectionError) throw inspectionError;

  const blocked = pickupLeaveBlockReason({
    inspectionComplete: Boolean(inspection?.completed_at),
    qualityChecked: Boolean(
      workOrder.quality_checked_at || workOrder.quality_checked_by_user_id
    ),
    safetyRequired: isSafetyRequired({
      safety_required: (safetyRow?.safety_required as boolean | null) ?? null,
      safety_waived: Boolean(safetyRow?.safety_waived),
      jobs: jobs ?? [],
    }),
    safetyChecked: Boolean(
      safetyRow?.safety_checked_at || safetyRow?.safety_checked_by_user_id
    ),
  });
  if (blocked) throw new Error(blocked);
}

export async function completeQualityCheck(
  workOrderId: string,
  notes?: string | null,
  options: {
    allowPeerTechnician?: boolean;
    signatureDataUrl?: string | null;
  } = {}
): Promise<void> {
  const { user, supabase, workOrder } = await requireMutableWorkOrder(workOrderId);
  if (
    !canRunQualityCheck(user.role) &&
    !(options.allowPeerTechnician && isFloorTech(user.role))
  ) {
    throw new Error("FORBIDDEN");
  }

  await assertAllActiveJobsCompleted(supabase, workOrderId);

  const { uploadInspectionSignature, removeInspectionSignature } =
    await import("@/lib/services/inspectionSignatures");
  const { insertQualityCheckAttempt } =
    await import("@/lib/services/checkAttemptEvidence");

  const signaturePath = await uploadInspectionSignature(supabase, {
    locationId: workOrder.location_id,
    workOrderId,
    kind: "qc",
    signatureDataUrl: options.signatureDataUrl ?? "",
  });

  const now = new Date().toISOString();
  const trimmedNotes = notes?.trim() || null;

  try {
    await insertQualityCheckAttempt(supabase, {
      workOrderId,
      locationId: workOrder.location_id,
      actorUserId: user.user_id,
      outcome: "passed",
      notes: trimmedNotes,
      signatureStoragePath: signaturePath,
    });

    const { error } = await supabase
      .from("work_order")
      .update({
        quality_checked_by_user_id: user.user_id,
        quality_checked_at: now,
        quality_check_notes: trimmedNotes,
        updated_at: now,
      })
      .eq("work_order_id", workOrderId);
    if (error) throw error;
  } catch (error) {
    await removeInspectionSignature(supabase, signaturePath);
    throw error;
  }

  await addTimelineEvent(supabase, {
    work_order_id: workOrderId,
    user_id: user.user_id,
    event_type: TimelineEventType.QUALITY_CHECK_COMPLETED,
    entity_type: "work_order",
    entity_id: workOrderId,
    description: "Quality check completed",
    old_value: {
      quality_checked_at: workOrder.quality_checked_at,
      quality_checked_by_user_id: workOrder.quality_checked_by_user_id,
    },
    new_value: {
      quality_checked_at: now,
      quality_checked_by_user_id: user.user_id,
      quality_check_notes: trimmedNotes,
      signature_storage_path: signaturePath,
    },
  });

  await addAuditLog(supabase, {
    actor_user_id: user.user_id,
    location_id: workOrder.location_id,
    action: "quality_check_completed",
    entity_type: "work_order",
    entity_id: workOrderId,
    description: "Quality check completed",
    old_value: {
      quality_checked_at: workOrder.quality_checked_at,
    },
    new_value: {
      quality_checked_at: now,
      quality_check_notes: trimmedNotes,
      signature_storage_path: signaturePath,
    },
  });

  await recalculateWorkOrderStatus(supabase, workOrderId, user.user_id);
}

export async function markReadyForPickup(workOrderId: string): Promise<void> {
  const { user, supabase, workOrder } = await requireMutableWorkOrder(workOrderId);
  if (!canMarkReadyForPickup(user.role)) throw new Error("FORBIDDEN");

  await assertAllActiveJobsCompleted(supabase, workOrderId);
  await assertPickupLeaveGates(supabase, workOrderId, workOrder);

  const now = new Date().toISOString();
  const { error } = await supabase
    .from("work_order")
    .update({
      ready_for_pickup_at: now,
      status: "ready_for_pickup",
      updated_at: now,
    })
    .eq("work_order_id", workOrderId);
  if (error) throw error;

  await addTimelineEvent(supabase, {
    work_order_id: workOrderId,
    user_id: user.user_id,
    event_type: TimelineEventType.READY_FOR_PICKUP,
    entity_type: "work_order",
    entity_id: workOrderId,
    description: "Marked ready for pickup",
    old_value: {
      ready_for_pickup_at: workOrder.ready_for_pickup_at,
      status: workOrder.status,
    },
    new_value: { ready_for_pickup_at: now, status: "ready_for_pickup" },
  });

  await addAuditLog(supabase, {
    actor_user_id: user.user_id,
    location_id: workOrder.location_id,
    action: "ready_for_pickup",
    entity_type: "work_order",
    entity_id: workOrderId,
    description: "Marked ready for pickup",
    old_value: {
      ready_for_pickup_at: workOrder.ready_for_pickup_at,
      status: workOrder.status,
    },
    new_value: { ready_for_pickup_at: now, status: "ready_for_pickup" },
  });
}

export async function completeWorkOrder(
  workOrderId: string,
  pickupNotes?: string | null
): Promise<void> {
  const { user, supabase, workOrder } = await requireMutableWorkOrder(workOrderId);
  if (!canCompleteWorkOrder(user.role)) throw new Error("FORBIDDEN");

  const canOverride = canOverrideWorkOrderStatus(user.role);
  if (
    workOrder.status !== "ready_for_pickup" &&
    !workOrder.ready_for_pickup_at &&
    !canOverride
  ) {
    throw new Error("NOT_READY_FOR_PICKUP");
  }

  await assertPickupLeaveGates(supabase, workOrderId, workOrder);

  const now = new Date().toISOString();
  const trimmedNotes = pickupNotes?.trim() || null;

  const { error } = await supabase
    .from("work_order")
    .update({
      status: "completed",
      completed_at: now,
      released_by_user_id: user.user_id,
      pickup_notes: trimmedNotes,
      updated_at: now,
    })
    .eq("work_order_id", workOrderId);
  if (error) throw error;

  await addTimelineEvent(supabase, {
    work_order_id: workOrderId,
    user_id: user.user_id,
    event_type: TimelineEventType.WORK_ORDER_COMPLETED,
    entity_type: "work_order",
    entity_id: workOrderId,
    description: "Work order completed / released",
    old_value: { status: workOrder.status },
    new_value: {
      status: "completed",
      completed_at: now,
      released_by_user_id: user.user_id,
      pickup_notes: trimmedNotes,
    },
  });

  await addAuditLog(supabase, {
    actor_user_id: user.user_id,
    location_id: workOrder.location_id,
    action: "work_order_completed",
    entity_type: "work_order",
    entity_id: workOrderId,
    description: "Work order completed / released",
    old_value: { status: workOrder.status },
    new_value: {
      status: "completed",
      completed_at: now,
      pickup_notes: trimmedNotes,
    },
  });
}

export async function cancelWorkOrder(
  workOrderId: string,
  reason: string
): Promise<void> {
  const { user, supabase, workOrder } = await requireMutableWorkOrder(workOrderId);
  if (!canCompleteWorkOrder(user.role) && !canOverrideWorkOrderStatus(user.role)) {
    throw new Error("FORBIDDEN");
  }

  const trimmed = reason.trim();
  if (!trimmed) throw new Error("CANCEL_NOTE_REQUIRED");

  const now = new Date().toISOString();
  const { error } = await supabase
    .from("work_order")
    .update({
      status: "cancelled",
      updated_at: now,
    })
    .eq("work_order_id", workOrderId);
  if (error) throw error;

  await addTimelineEvent(supabase, {
    work_order_id: workOrderId,
    user_id: user.user_id,
    event_type: TimelineEventType.WORK_ORDER_CANCELLED,
    entity_type: "work_order",
    entity_id: workOrderId,
    description: `Work order cancelled: ${trimmed}`,
    old_value: { status: workOrder.status },
    new_value: { status: "cancelled", reason: trimmed },
  });

  await addAuditLog(supabase, {
    actor_user_id: user.user_id,
    location_id: workOrder.location_id,
    action: "work_order_cancelled",
    entity_type: "work_order",
    entity_id: workOrderId,
    description: `Work order cancelled: ${trimmed}`,
    old_value: { status: workOrder.status },
    new_value: { status: "cancelled", reason: trimmed },
  });
}

export async function placeWorkOrderOnHold(
  workOrderId: string,
  reason?: string | null
): Promise<void> {
  const { user, supabase, workOrder } = await requireMutableWorkOrder(workOrderId);
  if (!canCompleteWorkOrder(user.role) && !canOverrideWorkOrderStatus(user.role)) {
    throw new Error("FORBIDDEN");
  }

  const trimmed = reason?.trim() || null;
  const now = new Date().toISOString();

  const { error } = await supabase
    .from("work_order")
    .update({
      status: "on_hold",
      updated_at: now,
    })
    .eq("work_order_id", workOrderId);
  if (error) throw error;

  await addTimelineEvent(supabase, {
    work_order_id: workOrderId,
    user_id: user.user_id,
    event_type: TimelineEventType.WORK_ORDER_PLACED_ON_HOLD,
    entity_type: "work_order",
    entity_id: workOrderId,
    description: trimmed
      ? `Work order placed on hold: ${trimmed}`
      : "Work order placed on hold",
    old_value: { status: workOrder.status },
    new_value: { status: "on_hold", reason: trimmed },
  });

  await addAuditLog(supabase, {
    actor_user_id: user.user_id,
    location_id: workOrder.location_id,
    action: "work_order_on_hold",
    entity_type: "work_order",
    entity_id: workOrderId,
    description: trimmed
      ? `Work order placed on hold: ${trimmed}`
      : "Work order placed on hold",
    old_value: { status: workOrder.status },
    new_value: { status: "on_hold", reason: trimmed },
  });
}

export async function resumeWorkOrderFromHold(workOrderId: string): Promise<void> {
  const { user, supabase, workOrder } = await requireMutableWorkOrder(workOrderId);
  if (!canOverrideWorkOrderStatus(user.role)) throw new Error("FORBIDDEN");
  if (workOrder.status !== "on_hold") throw new Error("NOT_ON_HOLD");

  // Reset to "open" so recalculation can derive the correct active status.
  const now = new Date().toISOString();
  const { error } = await supabase
    .from("work_order")
    .update({
      status: "open",
      updated_at: now,
    })
    .eq("work_order_id", workOrderId);
  if (error) throw error;

  await addTimelineEvent(supabase, {
    work_order_id: workOrderId,
    user_id: user.user_id,
    event_type: TimelineEventType.WORK_ORDER_STATUS_CHANGED,
    entity_type: "work_order",
    entity_id: workOrderId,
    description: "Resumed from hold",
    old_value: { status: "on_hold" },
    new_value: { status: "open" },
  });

  await addAuditLog(supabase, {
    actor_user_id: user.user_id,
    location_id: workOrder.location_id,
    action: "work_order_resumed_from_hold",
    entity_type: "work_order",
    entity_id: workOrderId,
    description: "Resumed from hold",
    old_value: { status: "on_hold" },
    new_value: { status: "open" },
  });

  await recalculateWorkOrderStatus(supabase, workOrderId, user.user_id);
}
