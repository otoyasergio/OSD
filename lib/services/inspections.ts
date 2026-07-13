import { requireUser, type AppUser } from "@/lib/auth/session";
import { createClient } from "@/lib/database/supabase-server";
import type { DbClient, InspectionResultStatus } from "@/lib/database/types";
import { addAuditLog } from "@/lib/audit/addAuditLog";
import { addTimelineEvent } from "@/lib/timeline/addTimelineEvent";
import { TimelineEventType } from "@/lib/timeline/events";
import {
  canCompleteInspection,
  canOverrideWorkOrderStatus,
  canViewClients,
} from "@/lib/permissions";
import { saveInspectionResultSchema } from "@/lib/validation/schemas";
import { recalculateWorkOrderStatus } from "@/lib/status/recalculateWorkOrderStatus";
import {
  assertInspectionPhotosComplete,
  countIncompleteInspectionResults,
  getMissingInspectionPhotos,
  type InspectionPhotoRequirement,
} from "@/lib/services/inspectionGate";

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

export type InspectionHeader = {
  customer_name: string | null;
  motorcycle_label: string | null;
  vin: string | null;
  mileage: number | null;
  technician_name: string | null;
  date_created: string | null;
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
  header: InspectionHeader;
  results: InspectionResultRow[];
  incomplete_count: number;
  missing_photos: InspectionPhotoRequirement[];
  photos: Array<{
    photo_id: string;
    category: string;
    inspection_result_id: string | null;
    signed_url: string | null;
    notes: string | null;
  }>;
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
  return countIncompleteInspectionResults(results);
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
  if (workOrder.status === "completed" || workOrder.status === "cancelled") {
    throw new Error("WORK_ORDER_LOCKED");
  }

  return {
    supabase,
    locationId: workOrder.location_id,
    workOrderNumber: workOrder.work_order_number,
  };
}

/** Create inspection + checklist rows when a WO was created without them. */
async function ensureInspectionSeeded(
  supabase: DbClient,
  workOrderId: string
): Promise<string> {
  const { data: existing, error: existingError } = await supabase
    .from("inspection")
    .select("inspection_id")
    .eq("work_order_id", workOrderId)
    .maybeSingle();

  if (existingError) throw existingError;
  if (existing?.inspection_id) return existing.inspection_id as string;

  const { data: inspection, error: inspectionError } = await supabase
    .from("inspection")
    .insert({ work_order_id: workOrderId })
    .select("inspection_id")
    .single();

  if (inspectionError) {
    // Race: another request created it first.
    if (inspectionError.code === "23505") {
      const { data: raced, error: racedError } = await supabase
        .from("inspection")
        .select("inspection_id")
        .eq("work_order_id", workOrderId)
        .maybeSingle();
      if (racedError) throw racedError;
      if (raced?.inspection_id) return raced.inspection_id as string;
    }
    throw inspectionError;
  }

  const inspectionId = inspection.inspection_id as string;

  const { data: templateItems, error: templateError } = await supabase
    .from("inspection_template_item")
    .select("template_item_id, category, item_name, display_order, requires_measurement")
    .eq("active", true)
    .order("display_order");

  if (templateError) throw templateError;

  if ((templateItems ?? []).length > 0) {
    const { error: resultsError } = await supabase.from("inspection_result").insert(
      (templateItems ?? []).map(
        (item: {
          template_item_id: string;
          category: string;
          item_name: string;
          display_order: number;
          requires_measurement: boolean;
        }) => ({
          inspection_id: inspectionId,
          template_item_id: item.template_item_id,
          category_snapshot: item.category,
          item_name_snapshot: item.item_name,
          display_order_snapshot: item.display_order,
          requires_measurement_snapshot: item.requires_measurement,
        })
      )
    );
    if (resultsError) throw resultsError;
  }

  return inspectionId;
}

export async function getInspectionForWorkOrder(
  workOrderId: string
): Promise<InspectionDetail | null> {
  const user = await requireUser();
  const supabase = await createClient();

  const { data: workOrder, error: woError } = await supabase
    .from("work_order")
    .select(
      `
      work_order_id,
      location_id,
      work_order_number,
      status,
      mileage,
      date_created,
      motorcycle:motorcycle_id (
        year,
        make,
        model,
        vin,
        customer:customer_id ( first_name, last_name )
      ),
      primary_technician:primary_technician_id (
        first_name,
        last_name
      )
    `
    )
    .eq("work_order_id", workOrderId)
    .maybeSingle();

  if (woError) throw woError;
  if (!workOrder) return null;

  const firstLoad = await supabase
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

  if (firstLoad.error) throw firstLoad.error;

  let inspection = firstLoad.data;

  if (!inspection) {
    await ensureInspectionSeeded(supabase, workOrderId);
    const reloaded = await supabase
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
    if (reloaded.error) throw reloaded.error;
    inspection = reloaded.data;
  }

  if (!inspection) return null;

  const results = ((inspection.inspection_result as InspectionResultRow[] | null) ?? [])
    .slice()
    .sort((a, b) => a.display_order_snapshot - b.display_order_snapshot);

  type NestedCustomer = { first_name: string; last_name: string };
  type NestedMotorcycle = {
    year: number;
    make: string;
    model: string;
    vin: string | null;
    customer: NestedCustomer | NestedCustomer[] | null;
  };
  type NestedTech = { first_name: string; last_name: string };

  const motorcycleRaw = workOrder.motorcycle as
    NestedMotorcycle | NestedMotorcycle[] | null;
  const motorcycle = Array.isArray(motorcycleRaw) ? motorcycleRaw[0] : motorcycleRaw;
  const customerRaw = motorcycle?.customer;
  const customer = Array.isArray(customerRaw) ? customerRaw[0] : customerRaw;
  const techRaw = workOrder.primary_technician as NestedTech | NestedTech[] | null;
  const tech = Array.isArray(techRaw) ? techRaw[0] : techRaw;

  const { data: photoRows, error: photoError } = await supabase
    .from("intake_photo")
    .select("photo_id, category, inspection_result_id, notes, storage_path, photo_url")
    .eq("work_order_id", workOrderId)
    .in("category", [
      "inspection_tires",
      "inspection_brakes",
      "inspection_forks",
      "inspection_item",
    ])
    .order("created_at", { ascending: false });
  if (photoError) throw photoError;

  const rawPhotos = (photoRows ?? []) as Array<{
    photo_id: string;
    category: string;
    inspection_result_id: string | null;
    notes: string | null;
    storage_path: string;
    photo_url: string | null;
  }>;

  const signedByPath = new Map<string, string | null>();
  if (rawPhotos.length > 0) {
    const { data: signed } = await supabase.storage
      .from("intake-photos")
      .createSignedUrls(
        rawPhotos.map((p) => p.storage_path),
        60 * 60
      );
    for (const row of signed ?? []) {
      if (row.path) {
        signedByPath.set(row.path, row.signedUrl ?? null);
      }
    }
  }

  const photos = rawPhotos.map((p) => ({
    photo_id: p.photo_id,
    category: p.category,
    inspection_result_id: p.inspection_result_id,
    notes: p.notes,
    signed_url: signedByPath.get(p.storage_path) ?? p.photo_url,
  }));

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
    header: {
      customer_name:
        canViewClients(user.role) && customer
          ? `${customer.first_name} ${customer.last_name}`
          : null,
      motorcycle_label: motorcycle
        ? `${motorcycle.year} ${motorcycle.make} ${motorcycle.model}`
        : null,
      vin: motorcycle?.vin ?? null,
      mileage: (workOrder.mileage as number | null) ?? null,
      technician_name: tech ? `${tech.first_name} ${tech.last_name}` : null,
      date_created: (workOrder.date_created as string | null) ?? null,
    },
    results,
    incomplete_count: countIncomplete(results),
    missing_photos: getMissingInspectionPhotos(results, photos),
    photos,
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
  if (workOrder.status === "completed" || workOrder.status === "cancelled") {
    throw new Error("WORK_ORDER_LOCKED");
  }
  if (inspection.completed_at) {
    throw new Error("INSPECTION_ALREADY_COMPLETE");
  }

  const nextStatus = parsed.status !== undefined ? parsed.status : row.status;
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

  const { supabase, locationId, workOrderNumber } = await requireMutableInspectionAccess(
    user,
    workOrderId
  );

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
        category_snapshot,
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
      category_snapshot: string;
      item_name_snapshot: string;
    }> | null) ?? [];
  const incompleteCount = countIncompleteInspectionResults(results);

  if (incompleteCount > 0) {
    if (!options.force || !canOverrideWorkOrderStatus(user.role)) {
      throw new Error("INSPECTION_INCOMPLETE");
    }
  }

  const { data: photoRows, error: photoError } = await supabase
    .from("intake_photo")
    .select("category, inspection_result_id")
    .eq("work_order_id", workOrderId)
    .in("category", [
      "inspection_tires",
      "inspection_brakes",
      "inspection_forks",
      "inspection_item",
    ]);
  if (photoError) throw photoError;

  assertInspectionPhotosComplete(
    results,
    (photoRows ?? []) as Array<{
      category: string;
      inspection_result_id: string | null;
    }>
  );

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
      incompleteCount > 0
        ? `Inspection completed with ${incompleteCount} incomplete item(s)`
        : "Inspection completed",
    new_value: {
      incomplete_count: incompleteCount,
      forced: Boolean(options.force && incompleteCount > 0),
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
      incomplete_count: incompleteCount,
      forced: Boolean(options.force && incompleteCount > 0),
    },
  });

  await recalculateWorkOrderStatus(supabase, workOrderId, user.user_id);
}
