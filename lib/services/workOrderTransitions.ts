import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/database/supabase-server";
import type { DbClient, WorkOrderStatus } from "@/lib/database/types";
import { addAuditLog } from "@/lib/audit/addAuditLog";
import { addTimelineEvent } from "@/lib/timeline/addTimelineEvent";
import { TimelineEventType } from "@/lib/timeline/events";
import {
  OWNER_SKIP_CHECKS_REASON,
  pickupLeaveBlockReason,
  storageLeaveBlockReason,
} from "@/lib/status/pickupGates";
import { isSafetyRequired } from "@/lib/status/safetyRequired";
import {
  checkoutPickupGateInput,
  loadCheckoutEvidenceState,
} from "@/lib/services/checkoutEvidence";
import {
  canCompleteWithoutFinalInspection,
  canParkAnyBikeInStorage,
} from "@/lib/permissions";
import {
  canDropInColumn,
  getTargetStatusForColumn,
  isPickupBoardColumn,
  isQcBoardColumn,
  isStorageBoardColumn,
} from "@/lib/status/transitions";
import { isUndefinedColumnError } from "@/lib/database/schemaCompat";

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
  checkout_evidence_required: boolean;
  checkout_evidence_override_at: string | null;
  checkout_evidence_override_by_user_id: string | null;
  checkout_evidence_override_reason: string | null;
};

async function loadWorkOrder(
  supabase: DbClient,
  workOrderId: string
): Promise<WorkOrderRow | null> {
  const { data, error } = await supabase
    .from("work_order")
    .select(
      "work_order_id, location_id, status, quality_checked_at, quality_checked_by_user_id, safety_checked_at, safety_checked_by_user_id, safety_required, safety_waived, checkout_evidence_required, checkout_evidence_override_at, checkout_evidence_override_by_user_id, checkout_evidence_override_reason"
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
 * - The owner skips every gate on a board drop: unfinished jobs, arrival
 *   inspection, final inspection, safety, and checkout photos. The placement
 *   is kept. Everyone else still waits for those checks.
 * - Ready / gallery Ready require a finished inspection, final inspection, and
 *   head-tech safety unless the office waived safety.
 * - Storage is a parking spot for the owner, a service advisor, or an admin:
 *   any active bike can go there. A manager still needs finished jobs, arrival
 *   inspection, and final inspection. Safety and checkout photos do not block
 *   storage. A stored bike with new unfinished work can leave Storage the next
 *   time its status is recalculated.
 * - complete uses the same leave gates as Overview (`completeWorkOrder`).
 *   Manager and admin may file a bike that already left without a final
 *   inspection or safety check. Billing is collected on the Billing tab.
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

  const ownerMove = user.role === "owner";
  const waiveQualityCheck = ownerMove && !isQcBoardColumn(targetColumnId);
  const parkInStorage =
    isStorageBoardColumn(targetColumnId) &&
    (ownerMove || canParkAnyBikeInStorage(user.role));

  if (isQcBoardColumn(targetColumnId) && !ownerMove) {
    await assertAllActiveJobsCompleted(supabase, workOrderId);
  }

  let ownerCheckoutSkip: {
    required: boolean;
    complete: boolean;
    overridden: boolean;
  } | null = null;

  if (
    isPickupBoardColumn(targetColumnId) ||
    (isStorageBoardColumn(targetColumnId) && !parkInStorage)
  ) {
    const [
      { data: safetyJobs, error: safetyJobsError },
      { data: inspection, error: inspectionError },
    ] = await Promise.all([
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
    if (safetyJobsError) throw safetyJobsError;
    if (inspectionError) throw inspectionError;
    const leaveInput = {
      inspectionComplete: Boolean(inspection?.completed_at),
      qualityChecked: Boolean(
        workOrder.quality_checked_at || workOrder.quality_checked_by_user_id
      ),
      waiveQualityCheck,
      skipAllGates: ownerMove,
      safetyRequired: isSafetyRequired({
        safety_required: workOrder.safety_required,
        safety_waived: workOrder.safety_waived,
        jobs: safetyJobs ?? [],
      }),
      safetyChecked: Boolean(
        workOrder.safety_checked_at || workOrder.safety_checked_by_user_id
      ),
    };
    if (isStorageBoardColumn(targetColumnId)) {
      if (!ownerMove) await assertAllActiveJobsCompleted(supabase, workOrderId);
      const blocked = storageLeaveBlockReason(leaveInput);
      if (blocked) throw new Error(blocked);
    } else {
      const checkout = await loadCheckoutEvidenceState(supabase, workOrderId, workOrder);
      if (ownerMove) ownerCheckoutSkip = checkout;
      const blocked = pickupLeaveBlockReason({
        ...leaveInput,
        ...checkoutPickupGateInput(checkout),
      });
      if (blocked) throw new Error(blocked);
    }
  }

  if (targetColumnId === "complete") {
    const { completeWorkOrder } = await import("@/lib/services/quality");
    const fileWithoutFinalInspection = canCompleteWithoutFinalInspection(user.role);
    await completeWorkOrder(workOrderId, null, {
      waiveQualityCheck: fileWithoutFinalInspection,
      waiveSafetyCheck: fileWithoutFinalInspection,
      ownerSkip: ownerMove,
    });
    return;
  }

  if (targetStatus === workOrder.status) return;

  const now = new Date().toISOString();
  const movePatch: Record<string, unknown> = {
    status: targetStatus,
    updated_at: now,
    ...(isPickupBoardColumn(targetColumnId) ? { ready_for_pickup_at: now } : {}),
    ...(isStorageBoardColumn(targetColumnId) ? { stored_at: now } : {}),
    ...(workOrder.status === "in_storage" && !isStorageBoardColumn(targetColumnId)
      ? { stored_at: null }
      : {}),
  };
  if (ownerMove) {
    movePatch.quality_check_waived = waiveQualityCheck;
    if (isPickupBoardColumn(targetColumnId) || isStorageBoardColumn(targetColumnId)) {
      movePatch.safety_waived = true;
    }
  }
  if (
    ownerCheckoutSkip &&
    ownerCheckoutSkip.required &&
    !ownerCheckoutSkip.complete &&
    !ownerCheckoutSkip.overridden
  ) {
    movePatch.checkout_evidence_override_reason = OWNER_SKIP_CHECKS_REASON;
    movePatch.checkout_evidence_override_at = now;
    movePatch.checkout_evidence_override_by_user_id = user.user_id;
  }
  const optionalColumns = ["stored_at", "quality_check_waived", "safety_waived"] as const;
  let { error } = await supabase
    .from("work_order")
    .update(movePatch)
    .eq("work_order_id", workOrderId);
  while (
    error &&
    optionalColumns.some(
      (column) => column in movePatch && isUndefinedColumnError(error, column)
    )
  ) {
    const missing = optionalColumns.find(
      (column) => column in movePatch && isUndefinedColumnError(error, column)
    );
    if (!missing) break;
    delete movePatch[missing];
    ({ error } = await supabase
      .from("work_order")
      .update(movePatch)
      .eq("work_order_id", workOrderId));
  }
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
    description: ownerMove
      ? `Owner moved the bike to ${targetColumnId} and skipped the usual checks`
      : parkInStorage
        ? "Parked the bike in storage and skipped the usual checks"
        : `Board move to ${targetColumnId} (${targetStatus})`,
    old_value: { status: workOrder.status },
    new_value: { status: targetStatus, column: targetColumnId },
  });
}
