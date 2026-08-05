import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/database/supabase-server";
import type { DbClient, WorkOrderStatus } from "@/lib/database/types";
import { addAuditLog } from "@/lib/audit/addAuditLog";
import { addTimelineEvent } from "@/lib/timeline/addTimelineEvent";
import { TimelineEventType } from "@/lib/timeline/events";
import { canOverrideWorkOrderStatus } from "@/lib/permissions";
import { isSafetyRequired } from "@/lib/status/safetyRequired";
import { canDropInColumn, getTargetStatusForColumn } from "@/lib/status/transitions";

type WorkOrderRow = {
  work_order_id: string;
  location_id: string;
  status: WorkOrderStatus;
  quality_checked_at: string | null;
  quality_checked_by_user_id: string | null;
  safety_checked_at: string | null;
  safety_checked_by_user_id: string | null;
  safety_required: boolean | null;
  safety_waived: boolean;
  billing_stage: string | null;
  square_payment_status: string | null;
};

async function loadWorkOrder(
  supabase: DbClient,
  workOrderId: string
): Promise<WorkOrderRow | null> {
  const { data, error } = await supabase
    .from("work_order")
    .select(
      "work_order_id, location_id, status, quality_checked_at, quality_checked_by_user_id, safety_checked_at, safety_checked_by_user_id, safety_required, safety_waived, billing_stage, square_payment_status"
    )
    .eq("work_order_id", workOrderId)
    .maybeSingle();
  if (error) throw error;
  const row = data as
    (Omit<WorkOrderRow, "safety_waived"> & { safety_waived: boolean | null }) | null;
  if (!row) return null;
  return { ...row, safety_waived: Boolean(row.safety_waived) };
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

/**
 * Board drag-and-drop status move. Sets status explicitly (override-style)
 * so recalculate does not immediately overwrite the drop target.
 * Hold/cancel must use detail-page actions, not the board.
 *
 * Gates:
 * - pickup requires a QC pass AND (safety not required OR a safety pass).
 * - complete requires billing paid, or an owner/manager override with a
 *   recorded reason.
 */
export async function moveWorkOrderOnBoard(
  workOrderId: string,
  targetColumnId: string,
  options: { billingOverrideReason?: string | null } = {}
): Promise<void> {
  const user = await requireUser();
  const supabase = await createClient();
  const workOrder = await loadWorkOrder(supabase, workOrderId);
  if (!workOrder) throw new Error("WORK_ORDER_NOT_FOUND");
  if (workOrder.location_id !== user.active_location_id) {
    throw new Error("FOREIGN_LOCATION");
  }

  const targetStatus = getTargetStatusForColumn(targetColumnId);
  if (targetStatus === null) {
    throw new Error("BOARD_MANUAL_STATUS_REQUIRED");
  }

  if (!canDropInColumn(user.role, targetColumnId, workOrder.status)) {
    throw new Error("FORBIDDEN");
  }

  if (targetColumnId === "qc") {
    await assertAllActiveJobsCompleted(supabase, workOrderId);
  }

  if (targetColumnId === "pickup") {
    if (!workOrder.quality_checked_at && !workOrder.quality_checked_by_user_id) {
      throw new Error("QC_REQUIRED");
    }

    const { data: safetyJobs, error: safetyJobsError } = await supabase
      .from("job")
      .select("status, service_name_snapshot")
      .eq("work_order_id", workOrderId);
    if (safetyJobsError) throw safetyJobsError;
    const safetyRequired = isSafetyRequired({
      safety_required: workOrder.safety_required,
      safety_waived: workOrder.safety_waived,
      jobs: safetyJobs ?? [],
    });
    if (
      safetyRequired &&
      !workOrder.safety_checked_at &&
      !workOrder.safety_checked_by_user_id
    ) {
      throw new Error("SAFETY_REQUIRED_BEFORE_PICKUP");
    }
  }

  if (targetColumnId === "complete") {
    const billingPaid =
      workOrder.billing_stage === "paid" || workOrder.square_payment_status === "paid";
    if (!billingPaid) {
      const reason = options.billingOverrideReason?.trim() ?? "";
      if (!canOverrideWorkOrderStatus(user.role)) {
        throw new Error("BILLING_NOT_PAID");
      }
      if (!reason) {
        throw new Error("OVERRIDE_REASON_REQUIRED");
      }
      await addAuditLog(supabase, {
        actor_user_id: user.user_id,
        location_id: workOrder.location_id,
        action: "work_order_complete_billing_override",
        entity_type: "work_order",
        entity_id: workOrderId,
        description: `Completed without payment collected — override: ${reason}`,
        new_value: {
          reason,
          billing_stage: workOrder.billing_stage,
          square_payment_status: workOrder.square_payment_status,
        },
      });
    }
    const { completeWorkOrder } = await import("@/lib/services/quality");
    await completeWorkOrder(workOrderId, null);
    return;
  }

  if (targetStatus === workOrder.status) return;

  const now = new Date().toISOString();
  const { error } = await supabase
    .from("work_order")
    .update({
      status: targetStatus,
      updated_at: now,
      ...(targetColumnId === "pickup" ? { ready_for_pickup_at: now } : {}),
    })
    .eq("work_order_id", workOrderId);
  if (error) throw error;

  await addTimelineEvent(supabase, {
    work_order_id: workOrderId,
    user_id: user.user_id,
    event_type: TimelineEventType.WORK_ORDER_STATUS_CHANGED,
    entity_type: "work_order",
    entity_id: workOrderId,
    description: `Board move: status changed to ${targetStatus}`,
    old_value: { status: workOrder.status, column: null },
    new_value: { status: targetStatus, column: targetColumnId },
  });

  await addAuditLog(supabase, {
    actor_user_id: user.user_id,
    location_id: workOrder.location_id,
    action: "work_order_board_move",
    entity_type: "work_order",
    entity_id: workOrderId,
    description: `Board move to ${targetColumnId} (${targetStatus})`,
    old_value: { status: workOrder.status },
    new_value: { status: targetStatus, column: targetColumnId },
  });
}
