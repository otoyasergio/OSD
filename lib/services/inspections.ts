import { requireUser, type AppUser } from "@/lib/auth/session";
import { createClient } from "@/lib/database/supabase-server";
import type {
  DbClient,
  InspectionResultStatus,
} from "@/lib/database/types";
import { addAuditLog } from "@/lib/audit/addAuditLog";
import { addTimelineEvent } from "@/lib/timeline/addTimelineEvent";
import { TimelineEventType } from "@/lib/timeline/events";
import {
  canCompleteInspection,
  canOverrideWorkOrderStatus,
} from "@/lib/permissions";
import { saveInspectionResultSchema } from "@/lib/validation/schemas";
import { recalculateWorkOrderStatus } from "@/lib/status/recalculateWorkOrderStatus";

export type InspectionResultRow = {
  inspection_result_id: string;
  inspection_id: string;
  template_item_id: string;
  category_snapshot: string;
  item_name_snapshot: string;
  display_order_snapshot: number;
  requires_measurement_snapshot: boolean;
  status: InspectionResultStatus | null;
  measurement: string | null;
  notes: string | null;
  updated_by_user_id: string | null;
  updated_at: string;
};

export type InspectionDetail = {
  inspection_id: string;
  work_order_id: string;
  started_at: string | null;
  completed_at: string | null;
  completed_by_user_id: string | null;
  location_id: string;
  work_order_number: string;
  work_order_status: string;
  is_foreign_location: boolean;
  results: InspectionResultRow[];
  incomplete_count: number;
};

type ResultWithInspection = InspectionResultRow & {
  inspection: {
    inspection_id: string;
    work_order_id: string;
    started_at: string | null;
    completed_at: string | null;
    work_order: {
      work_order_id: string;
      location_id: string;
      work_order_number: string;
      status: string;
    };
  };
};

const RESULT_COLUMNS =
  "inspection_result_id, inspection_id, template_item_id, category_snapshot, item_name_snapshot, display_order_snapshot, requires_measurement_snapshot, status, measurement, notes, updated_by_user_id, updated_at";

function countIncomplete(results: InspectionResultRow[]): number {
  return results.filter((r) => r.status == null).length;
}

async function requireMutableInspectionAccess(
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

export async function getInspectionForWorkOrder(
  workOrderId: string
): Promise<InspectionDetail | null> {
  const user = await requireUser();
  const supabase = await createClient();

  const { data: workOrder, error: woError } = await supabase
    .from("work_order")
    .select("work_order_id, location_id, work_order_number, status")
    .eq("work_order_id", workOrderId)
    .maybeSingle();

  if (woError) throw woError;
  if (!workOrder) return null;

  const { data: inspection, error } = await supabase
    .from("inspection")
    .select(
      `
      inspection_id,
      work_order_id,
      started_at,
      completed_at,
      completed_by_user_id,
      inspection_result (
        ${RESULT_COLUMNS}
      )
    `
    )
    .eq("work_order_id", workOrderId)
    .maybeSingle();

  if (error) throw error;
  if (!inspection) return null;

  const results = (
    (inspection.inspection_result as InspectionResultRow[] | null) ?? []
  ).slice().sort(
    (a, b) => a.display_order_snapshot - b.display_order_snapshot
  );

  return {
    inspection_id: inspection.inspection_id,
    work_order_id: inspection.work_order_id,
    started_at: inspection.started_at,
    completed_at: inspection.completed_at,
    completed_by_user_id: inspection.completed_by_user_id,
    location_id: workOrder.location_id,
    work_order_number: workOrder.work_order_number,
    work_order_status: workOrder.status,
    is_foreign_location: workOrder.location_id !== user.active_location_id,
    results,
    incomplete_count: countIncomplete(results),
  };
}

export async function saveInspectionResult(
  inspectionResultId: string,
  input: {
    status?: InspectionResultStatus | null;
    measurement?: string | null;
    notes?: string | null;
  }
): Promise<InspectionResultRow> {
  const user = await requireUser();
  if (!canCompleteInspection(user.role)) throw new Error("FORBIDDEN");

  const parsed = saveInspectionResultSchema.parse(input);
  const supabase = await createClient();

  const { data: existing, error: loadError } = await supabase
    .from("inspection_result")
    .select(
      `
      ${RESULT_COLUMNS},
      inspection:inspection_id (
        inspection_id,
        work_order_id,
        started_at,
        completed_at,
        work_order:work_order_id (
          work_order_id,
          location_id,
          work_order_number,
          status
        )
      )
    `
    )
    .eq("inspection_result_id", inspectionResultId)
    .maybeSingle();

  if (loadError) throw loadError;
  if (!existing) throw new Error("INSPECTION_RESULT_NOT_FOUND");

  const row = existing as unknown as ResultWithInspection;
  const inspection = row.inspection;
  const workOrder = inspection.work_order;

  if (workOrder.location_id !== user.active_location_id) {
    throw new Error("FOREIGN_LOCATION");
  }
  if (
    workOrder.status === "completed" ||
    workOrder.status === "cancelled"
  ) {
    throw new Error("WORK_ORDER_LOCKED");
  }
  if (inspection.completed_at) {
    throw new Error("INSPECTION_ALREADY_COMPLETE");
  }

  const nextStatus =
    parsed.status !== undefined ? parsed.status : row.status;
  const nextMeasurement =
    parsed.measurement !== undefined ? parsed.measurement : row.measurement;
  const nextNotes = parsed.notes !== undefined ? parsed.notes : row.notes;

  const { data: updated, error } = await supabase
    .from("inspection_result")
    .update({
      status: nextStatus,
      measurement: nextMeasurement,
      notes: nextNotes,
      updated_by_user_id: user.user_id,
      updated_at: new Date().toISOString(),
    })
    .eq("inspection_result_id", inspectionResultId)
    .select(RESULT_COLUMNS)
    .single();

  if (error) throw error;
  const result = updated as InspectionResultRow;

  if (!inspection.started_at) {
    const now = new Date().toISOString();
    await supabase
      .from("inspection")
      .update({ started_at: now, updated_at: now })
      .eq("inspection_id", inspection.inspection_id);

    if (workOrder.status === "open" || workOrder.status === "draft") {
      await supabase
        .from("work_order")
        .update({
          status: "inspection_in_progress",
          updated_at: now,
        })
        .eq("work_order_id", workOrder.work_order_id);

      await addTimelineEvent(supabase, {
        work_order_id: workOrder.work_order_id,
        user_id: user.user_id,
        event_type: TimelineEventType.INSPECTION_STARTED,
        entity_type: "inspection",
        entity_id: inspection.inspection_id,
        description: "Inspection started",
      });

      await addTimelineEvent(supabase, {
        work_order_id: workOrder.work_order_id,
        user_id: user.user_id,
        event_type: TimelineEventType.WORK_ORDER_STATUS_CHANGED,
        entity_type: "work_order",
        entity_id: workOrder.work_order_id,
        description: "Work order status changed to inspection_in_progress",
        old_value: { status: workOrder.status },
        new_value: { status: "inspection_in_progress" },
      });
    } else {
      await addTimelineEvent(supabase, {
        work_order_id: workOrder.work_order_id,
        user_id: user.user_id,
        event_type: TimelineEventType.INSPECTION_STARTED,
        entity_type: "inspection",
        entity_id: inspection.inspection_id,
        description: "Inspection started",
      });
    }
  }

  const statusChanged = row.status !== result.status;
  const significant =
    statusChanged &&
    (result.status === "future_attention" ||
      result.status === "immediate_attention" ||
      row.status === "future_attention" ||
      row.status === "immediate_attention");

  if (significant || statusChanged) {
    await addTimelineEvent(supabase, {
      work_order_id: workOrder.work_order_id,
      user_id: user.user_id,
      event_type: TimelineEventType.INSPECTION_RESULT_UPDATED,
      entity_type: "inspection_result",
      entity_id: inspectionResultId,
      description: `${result.item_name_snapshot}: ${result.status ?? "incomplete"}`,
      old_value: { status: row.status },
      new_value: { status: result.status },
    });
  }

  await addAuditLog(supabase, {
    actor_user_id: user.user_id,
    location_id: workOrder.location_id,
    action: "inspection_result_updated",
    entity_type: "inspection_result",
    entity_id: inspectionResultId,
    description: `Inspection result updated: ${result.item_name_snapshot}`,
    old_value: {
      status: row.status,
      measurement: row.measurement,
      notes: row.notes,
    },
    new_value: {
      status: result.status,
      measurement: result.measurement,
      notes: result.notes,
    },
  });

  return result;
}

export async function completeInspection(
  workOrderId: string,
  options: { force?: boolean } = {}
): Promise<void> {
  const user = await requireUser();
  if (!canCompleteInspection(user.role)) throw new Error("FORBIDDEN");

  const { supabase, locationId, workOrderNumber } =
    await requireMutableInspectionAccess(user, workOrderId);

  const { data: inspection, error } = await supabase
    .from("inspection")
    .select(
      `
      inspection_id,
      started_at,
      completed_at,
      inspection_result (
        inspection_result_id,
        status,
        item_name_snapshot
      )
    `
    )
    .eq("work_order_id", workOrderId)
    .maybeSingle();

  if (error) throw error;
  if (!inspection) throw new Error("INSPECTION_NOT_FOUND");
  if (inspection.completed_at) throw new Error("INSPECTION_ALREADY_COMPLETE");

  const results =
    (inspection.inspection_result as Array<{
      inspection_result_id: string;
      status: string | null;
      item_name_snapshot: string;
    }> | null) ?? [];
  const incomplete = results.filter((r) => r.status == null);

  if (incomplete.length > 0) {
    if (!options.force || !canOverrideWorkOrderStatus(user.role)) {
      throw new Error("INSPECTION_INCOMPLETE");
    }
  }

  const now = new Date().toISOString();
  const { error: updateError } = await supabase
    .from("inspection")
    .update({
      completed_at: now,
      completed_by_user_id: user.user_id,
      updated_at: now,
      ...(inspection.started_at ? {} : { started_at: now }),
    })
    .eq("inspection_id", inspection.inspection_id);

  if (updateError) throw updateError;

  await addTimelineEvent(supabase, {
    work_order_id: workOrderId,
    user_id: user.user_id,
    event_type: TimelineEventType.INSPECTION_COMPLETED,
    entity_type: "inspection",
    entity_id: inspection.inspection_id,
    description:
      incomplete.length > 0
        ? `Inspection completed with ${incomplete.length} incomplete item(s)`
        : "Inspection completed",
    new_value: {
      incomplete_count: incomplete.length,
      forced: Boolean(options.force && incomplete.length > 0),
    },
  });

  await addAuditLog(supabase, {
    actor_user_id: user.user_id,
    location_id: locationId,
    action: "inspection_completed",
    entity_type: "inspection",
    entity_id: inspection.inspection_id,
    description: `Inspection completed on ${workOrderNumber}`,
    new_value: {
      incomplete_count: incomplete.length,
      forced: Boolean(options.force && incomplete.length > 0),
    },
  });

  await recalculateWorkOrderStatus(supabase, workOrderId, user.user_id);
}
