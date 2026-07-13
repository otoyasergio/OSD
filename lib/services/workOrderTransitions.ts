import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/database/supabase-server";
import type { DbClient, WorkOrderStatus } from "@/lib/database/types";
import { addAuditLog } from "@/lib/audit/addAuditLog";
import { addTimelineEvent } from "@/lib/timeline/addTimelineEvent";
import { TimelineEventType } from "@/lib/timeline/events";
import {
  canDropInColumn,
  getTargetStatusForColumn,
} from "@/lib/status/transitions";

type WorkOrderRow = {
  work_order_id: string;
  location_id: string;
  status: WorkOrderStatus;
  quality_checked_at: string | null;
  quality_checked_by_user_id: string | null;
};

async function loadWorkOrder(
  supabase: DbClient,
  workOrderId: string
): Promise<WorkOrderRow | null> {
  const { data, error } = await supabase
    .from("work_order")
    .select(
      "work_order_id, location_id, status, quality_checked_at, quality_checked_by_user_id"
    )
    .eq("work_order_id", workOrderId)
    .maybeSingle();
  if (error) throw error;
  return (data as WorkOrderRow) ?? null;
}

function isActiveJob(status: string) {
  return status !== "cancelled" && status !== "declined";
}

async function assertAllActiveJobsCompleted(
  supabase: DbClient,
  workOrderId: string
) {
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
 */
export async function moveWorkOrderOnBoard(
  workOrderId: string,
  targetColumnId: string
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

  if (targetColumnId === "ready") {
    const { data: agreement, error: agreementError } = await supabase
      .from("drop_off_agreement")
      .select("agreement_id")
      .eq("work_order_id", workOrderId)
      .maybeSingle();
    if (agreementError) throw agreementError;
    if (!agreement) throw new Error("CONTRACT_REQUIRED");
  }

  if (targetColumnId === "pickup") {
    if (!workOrder.quality_checked_at && !workOrder.quality_checked_by_user_id) {
      throw new Error("QC_REQUIRED");
    }
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
