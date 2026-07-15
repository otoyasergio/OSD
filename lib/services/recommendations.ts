import { requireUser, type AppUser } from "@/lib/auth/session";
import { createClient } from "@/lib/database/supabase-server";
import type {
  DbClient,
  InspectionResultStatus,
  JobStatus,
  RecommendationSeverity,
  RecommendationStatus,
} from "@/lib/database/types";
import { addAuditLog } from "@/lib/audit/addAuditLog";
import { addTimelineEvent } from "@/lib/timeline/addTimelineEvent";
import { TimelineEventType } from "@/lib/timeline/events";
import {
  canConvertRecommendation,
  canCreateRecommendation,
  canRecordCustomerApproval,
} from "@/lib/permissions";
import { recommendationSchema } from "@/lib/validation/schemas";
import { recalculateWorkOrderStatus } from "@/lib/status/recalculateWorkOrderStatus";
import {
  severityFromInspectionStatus,
  shouldAutoCreateRecommendation,
  shouldSkipDuplicateRecommendation,
} from "@/lib/services/autoRecommendationFromInspection";

export type Recommendation = {
  recommendation_id: string;
  work_order_id: string;
  inspection_result_id: string | null;
  created_by_user_id: string | null;
  description: string;
  severity: RecommendationSeverity;
  status: RecommendationStatus;
  converted_job_id: string | null;
  notes: string | null;
  created_at: string;
  resolved_at: string | null;
  inspection_result?: {
    item_name_snapshot: string;
    category_snapshot: string;
    status: InspectionResultStatus | null;
  } | null;
};

export type OutstandingRecommendation = Recommendation & {
  work_order: {
    work_order_id: string;
    work_order_number: string;
    status: string;
  };
};

const OUTSTANDING_STATUSES: RecommendationStatus[] = [
  "pending",
  "deferred",
  "declined",
];

const COLUMNS =
  "recommendation_id, work_order_id, inspection_result_id, created_by_user_id, description, severity, status, converted_job_id, notes, created_at, resolved_at";

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

export async function listRecommendationsForWorkOrder(
  workOrderId: string
): Promise<Recommendation[]> {
  await requireUser();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("recommendation")
    .select(
      `
      ${COLUMNS},
      inspection_result:inspection_result_id (
        item_name_snapshot,
        category_snapshot,
        status
      )
    `
    )
    .eq("work_order_id", workOrderId)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data ?? []) as unknown as Recommendation[];
}

export async function listOutstandingRecommendationsForMotorcycle(
  motorcycleId: string,
  excludeWorkOrderId?: string
): Promise<OutstandingRecommendation[]> {
  await requireUser();
  const supabase = await createClient();

  const { data: workOrders, error: woError } = await supabase
    .from("work_order")
    .select("work_order_id, work_order_number, status")
    .eq("motorcycle_id", motorcycleId)
    .not("status", "in", '("completed","cancelled")');

  if (woError) throw woError;

  const activeWorkOrders = (workOrders ?? []).filter(
    (wo) => wo.work_order_id !== excludeWorkOrderId
  );
  if (activeWorkOrders.length === 0) return [];

  const workOrderById = new Map(
    activeWorkOrders.map((wo) => [
      wo.work_order_id as string,
      {
        work_order_id: wo.work_order_id as string,
        work_order_number: wo.work_order_number as string,
        status: wo.status as string,
      },
    ])
  );

  const { data, error } = await supabase
    .from("recommendation")
    .select(COLUMNS)
    .in("work_order_id", [...workOrderById.keys()])
    .in("status", OUTSTANDING_STATUSES)
    .order("created_at", { ascending: false });

  if (error) throw error;

  return (data ?? []).map((row) => {
    const workOrder = workOrderById.get(row.work_order_id as string)!;
    return {
      ...(row as Recommendation),
      work_order: workOrder,
    };
  });
}

export async function createRecommendation(
  workOrderId: string,
  input: {
    description: string;
    severity: RecommendationSeverity;
    notes?: string | null;
    inspection_result_id?: string | null;
  }
): Promise<Recommendation> {
  const user = await requireUser();
  if (!canCreateRecommendation(user.role)) throw new Error("FORBIDDEN");

  const parsed = recommendationSchema.parse(input);
  const { supabase, locationId, workOrderNumber } =
    await requireMutableWorkOrder(user, workOrderId);

  if (parsed.inspection_result_id) {
    const { data: result, error: resultError } = await supabase
      .from("inspection_result")
      .select(
        `
        inspection_result_id,
        inspection:inspection_id ( work_order_id )
      `
      )
      .eq("inspection_result_id", parsed.inspection_result_id)
      .maybeSingle();

    if (resultError) throw resultError;
    if (!result) throw new Error("INSPECTION_RESULT_NOT_FOUND");
    const inspection = result.inspection as unknown as {
      work_order_id: string;
    } | null;
    if (!inspection || inspection.work_order_id !== workOrderId) {
      throw new Error("INSPECTION_RESULT_NOT_FOUND");
    }
  }

  const { data, error } = await supabase
    .from("recommendation")
    .insert({
      work_order_id: workOrderId,
      inspection_result_id: parsed.inspection_result_id ?? null,
      created_by_user_id: user.user_id,
      description: parsed.description,
      severity: parsed.severity,
      notes: parsed.notes ?? null,
      status: "pending",
    })
    .select(COLUMNS)
    .single();

  if (error) throw error;
  const recommendation = data as Recommendation;

  await addTimelineEvent(supabase, {
    work_order_id: workOrderId,
    user_id: user.user_id,
    event_type: TimelineEventType.RECOMMENDATION_CREATED,
    entity_type: "recommendation",
    entity_id: recommendation.recommendation_id,
    description: `Recommendation created: ${recommendation.description}`,
    new_value: {
      severity: recommendation.severity,
      status: recommendation.status,
    },
  });

  await addAuditLog(supabase, {
    actor_user_id: user.user_id,
    location_id: locationId,
    action: "recommendation_created",
    entity_type: "recommendation",
    entity_id: recommendation.recommendation_id,
    description: `Recommendation created on ${workOrderNumber}`,
    new_value: recommendation,
  });

  return recommendation;
}

/**
 * Idempotent: creates a pending recommendation for a yellow/red inspection
 * result if one is not already linked. Office handles decline/defer if the
 * tech later clears the flag — we do not auto-delete.
 */
export async function ensureRecommendationForInspectionResult(
  inspectionResultId: string
): Promise<Recommendation | null> {
  const user = await requireUser();
  if (!canCreateRecommendation(user.role)) throw new Error("FORBIDDEN");

  const supabase = await createClient();
  const { data: result, error } = await supabase
    .from("inspection_result")
    .select(
      `
      inspection_result_id,
      item_name_snapshot,
      category_snapshot,
      status,
      notes,
      inspection:inspection_id ( work_order_id )
    `
    )
    .eq("inspection_result_id", inspectionResultId)
    .maybeSingle();

  if (error) throw error;
  if (!result) throw new Error("INSPECTION_RESULT_NOT_FOUND");

  const status = result.status as InspectionResultStatus | null;
  if (!shouldAutoCreateRecommendation(status)) {
    return null;
  }

  const inspection = result.inspection as unknown as {
    work_order_id: string;
  } | null;
  if (!inspection) throw new Error("INSPECTION_NOT_FOUND");

  const { data: existingRows, error: existingError } = await supabase
    .from("recommendation")
    .select("recommendation_id, inspection_result_id")
    .eq("inspection_result_id", inspectionResultId)
    .limit(1);

  if (existingError) throw existingError;
  if (
    shouldSkipDuplicateRecommendation(
      (existingRows ?? []).map((r) => r.inspection_result_id as string),
      inspectionResultId
    )
  ) {
    const existingId = existingRows![0].recommendation_id as string;
    const { data: existing, error: loadError } = await supabase
      .from("recommendation")
      .select(COLUMNS)
      .eq("recommendation_id", existingId)
      .single();
    if (loadError) throw loadError;
    return existing as Recommendation;
  }

  return createRecommendation(inspection.work_order_id, {
    description: `${result.item_name_snapshot} (${result.category_snapshot})`,
    severity: severityFromInspectionStatus(status),
    notes: (result.notes as string | null) ?? null,
    inspection_result_id: inspectionResultId,
  });
}

export async function createRecommendationFromInspectionResult(
  inspectionResultId: string,
  input: {
    description?: string;
    severity?: RecommendationSeverity;
    notes?: string | null;
  } = {}
): Promise<Recommendation> {
  // Prefer idempotent ensure when no overrides; still allow description/severity overrides.
  if (
    input.description === undefined &&
    input.severity === undefined &&
    input.notes === undefined
  ) {
    const ensured = await ensureRecommendationForInspectionResult(
      inspectionResultId
    );
    if (ensured) return ensured;
  }

  const user = await requireUser();
  if (!canCreateRecommendation(user.role)) throw new Error("FORBIDDEN");

  const supabase = await createClient();
  const { data: result, error } = await supabase
    .from("inspection_result")
    .select(
      `
      inspection_result_id,
      item_name_snapshot,
      category_snapshot,
      status,
      notes,
      inspection:inspection_id ( work_order_id )
    `
    )
    .eq("inspection_result_id", inspectionResultId)
    .maybeSingle();

  if (error) throw error;
  if (!result) throw new Error("INSPECTION_RESULT_NOT_FOUND");

  const inspection = result.inspection as unknown as {
    work_order_id: string;
  } | null;
  if (!inspection) throw new Error("INSPECTION_NOT_FOUND");

  const { data: existingRows, error: existingError } = await supabase
    .from("recommendation")
    .select("recommendation_id")
    .eq("inspection_result_id", inspectionResultId)
    .limit(1);
  if (existingError) throw existingError;
  if (existingRows && existingRows.length > 0) {
    const ensured = await ensureRecommendationForInspectionResult(
      inspectionResultId
    );
    if (ensured) return ensured;
  }

  const defaultSeverity = severityFromInspectionStatus(
    result.status as InspectionResultStatus | null
  );

  return createRecommendation(inspection.work_order_id, {
    description:
      input.description?.trim() ||
      `${result.item_name_snapshot} (${result.category_snapshot})`,
    severity: input.severity ?? defaultSeverity,
    notes: input.notes ?? result.notes,
    inspection_result_id: inspectionResultId,
  });
}

export async function updateRecommendationStatus(
  recommendationId: string,
  status: Exclude<RecommendationStatus, "converted_to_job" | "pending">,
  notes?: string | null
): Promise<Recommendation> {
  const user = await requireUser();
  if (
    !canRecordCustomerApproval(user.role) &&
    !canCreateRecommendation(user.role)
  ) {
    throw new Error("FORBIDDEN");
  }

  const supabase = await createClient();
  const { data: existing, error: loadError } = await supabase
    .from("recommendation")
    .select(COLUMNS)
    .eq("recommendation_id", recommendationId)
    .maybeSingle();

  if (loadError) throw loadError;
  if (!existing) throw new Error("RECOMMENDATION_NOT_FOUND");
  if (existing.status === "converted_to_job") {
    throw new Error("RECOMMENDATION_ALREADY_CONVERTED");
  }

  const { locationId, workOrderNumber } = await requireMutableWorkOrder(
    user,
    existing.work_order_id
  );

  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("recommendation")
    .update({
      status,
      notes: notes !== undefined ? notes : existing.notes,
      resolved_at:
        status === "approved" || status === "declined" || status === "deferred"
          ? now
          : existing.resolved_at,
    })
    .eq("recommendation_id", recommendationId)
    .select(COLUMNS)
    .single();

  if (error) throw error;
  const recommendation = data as Recommendation;

  await addTimelineEvent(supabase, {
    work_order_id: existing.work_order_id,
    user_id: user.user_id,
    event_type: TimelineEventType.RECOMMENDATION_STATUS_CHANGED,
    entity_type: "recommendation",
    entity_id: recommendationId,
    description: `Recommendation ${status}: ${recommendation.description}`,
    old_value: { status: existing.status },
    new_value: { status },
  });

  await addAuditLog(supabase, {
    actor_user_id: user.user_id,
    location_id: locationId,
    action: "recommendation_status_changed",
    entity_type: "recommendation",
    entity_id: recommendationId,
    description: `Recommendation status changed on ${workOrderNumber}`,
    old_value: { status: existing.status },
    new_value: { status },
  });

  return recommendation;
}

export async function convertRecommendationToJob(
  recommendationId: string,
  input: { service_id: string; already_approved?: boolean }
): Promise<{ job_id: string; recommendation_id: string }> {
  const user = await requireUser();
  if (!canConvertRecommendation(user.role)) throw new Error("FORBIDDEN");

  const supabase = await createClient();
  const { data: existing, error: loadError } = await supabase
    .from("recommendation")
    .select(COLUMNS)
    .eq("recommendation_id", recommendationId)
    .maybeSingle();

  if (loadError) throw loadError;
  if (!existing) throw new Error("RECOMMENDATION_NOT_FOUND");
  if (existing.status === "converted_to_job" || existing.converted_job_id) {
    throw new Error("RECOMMENDATION_ALREADY_CONVERTED");
  }

  const { locationId, workOrderNumber } = await requireMutableWorkOrder(
    user,
    existing.work_order_id
  );

  const { data: service, error: serviceError } = await supabase
    .from("service")
    .select("service_id, name, standard_price, estimated_labour, active")
    .eq("service_id", input.service_id)
    .maybeSingle();

  if (serviceError) throw serviceError;
  if (!service || !service.active) throw new Error("SERVICE_NOT_FOUND");

  const alreadyApproved =
    Boolean(input.already_approved) || existing.status === "approved";
  const jobStatus: JobStatus = alreadyApproved
    ? "approved"
    : "waiting_for_approval";

  const { data: job, error: jobError } = await supabase
    .from("job")
    .insert({
      work_order_id: existing.work_order_id,
      service_id: service.service_id,
      service_name_snapshot: service.name,
      standard_price_snapshot: service.standard_price,
      estimated_labour_snapshot: service.estimated_labour,
      status: jobStatus,
      created_by_user_id: user.user_id,
      notes: `From recommendation: ${existing.description}`,
      ...(alreadyApproved
        ? {
            approved_by_customer_at: new Date().toISOString(),
            approval_method: "in_person",
            approval_recorded_by_user_id: user.user_id,
          }
        : {}),
    })
    .select("job_id, service_name_snapshot")
    .single();

  if (jobError) throw jobError;

  const now = new Date().toISOString();
  const { error: recError } = await supabase
    .from("recommendation")
    .update({
      status: "converted_to_job",
      converted_job_id: job.job_id,
      resolved_at: now,
    })
    .eq("recommendation_id", recommendationId);

  if (recError) throw recError;

  await addTimelineEvent(supabase, {
    work_order_id: existing.work_order_id,
    user_id: user.user_id,
    event_type: TimelineEventType.JOB_CREATED,
    entity_type: "job",
    entity_id: job.job_id,
    description: `Job created: ${job.service_name_snapshot}`,
    new_value: { status: jobStatus },
  });

  await addTimelineEvent(supabase, {
    work_order_id: existing.work_order_id,
    user_id: user.user_id,
    event_type: TimelineEventType.RECOMMENDATION_CONVERTED_TO_JOB,
    entity_type: "recommendation",
    entity_id: recommendationId,
    description: `Recommendation converted to job: ${job.service_name_snapshot}`,
    new_value: { job_id: job.job_id, status: "converted_to_job" },
  });

  await addAuditLog(supabase, {
    actor_user_id: user.user_id,
    location_id: locationId,
    action: "recommendation_converted_to_job",
    entity_type: "recommendation",
    entity_id: recommendationId,
    description: `Recommendation converted on ${workOrderNumber}`,
    new_value: {
      job_id: job.job_id,
      service_id: service.service_id,
      job_status: jobStatus,
    },
  });

  await recalculateWorkOrderStatus(
    supabase,
    existing.work_order_id,
    user.user_id
  );

  return {
    job_id: job.job_id,
    recommendation_id: recommendationId,
  };
}
