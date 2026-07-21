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
import { assignTechnicianToJob } from "@/lib/services/jobs";

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

const OUTSTANDING_STATUSES: RecommendationStatus[] = ["pending", "deferred", "declined"];

const COLUMNS =
  "recommendation_id, work_order_id, inspection_result_id, created_by_user_id, description, severity, status, converted_job_id, notes, created_at, resolved_at";

export function severityFromInspectionStatus(
  status: InspectionResultStatus | null
): RecommendationSeverity {
  if (status === "immediate_attention") return "immediate_attention";
  return "future_attention";
}

/** Yellow / red inspection findings that should become recommendations. */
export function isAttentionInspectionStatus(
  status: string | null | undefined
): status is "future_attention" | "immediate_attention" {
  return status === "future_attention" || status === "immediate_attention";
}

export type AttentionFindingInput = {
  inspection_result_id: string;
  status: string | null;
  item_name_snapshot: string;
  category_snapshot: string;
  notes?: string | null;
};

export type RecommendationSyncPlan =
  | { action: "none" }
  | { action: "create"; severity: RecommendationSeverity }
  | { action: "update_severity"; severity: RecommendationSeverity }
  | { action: "withdraw" };

/**
 * Decide how a live inspection finding change maps onto its linked
 * recommendation. Only untouched pending recommendations are mutated;
 * anything staff acted on (approved / declined / deferred / converted)
 * is left alone.
 */
export function planRecommendationSyncForFinding(
  existing: Pick<Recommendation, "status" | "severity" | "converted_job_id"> | null,
  findingStatus: string | null
): RecommendationSyncPlan {
  if (isAttentionInspectionStatus(findingStatus)) {
    const severity = severityFromInspectionStatus(
      findingStatus as InspectionResultStatus
    );
    if (!existing) return { action: "create", severity };
    if (existing.status === "pending" && existing.severity !== severity) {
      return { action: "update_severity", severity };
    }
    return { action: "none" };
  }
  if (existing && existing.status === "pending" && !existing.converted_job_id) {
    return { action: "withdraw" };
  }
  return { action: "none" };
}

/**
 * Live sync while the tech works the checklist: flagging an item yellow/red
 * immediately creates a pending client recommendation; clearing the flag
 * withdraws the auto-created recommendation if staff have not acted on it.
 */
export async function syncRecommendationForInspectionResult(input: {
  work_order_id: string;
  inspection_result_id: string;
  status: string | null;
  item_name_snapshot: string;
  category_snapshot: string;
  notes?: string | null;
}): Promise<void> {
  const user = await requireUser();
  if (!canCreateRecommendation(user.role)) return;

  const supabase = await createClient();
  const { data: linked, error: linkedError } = await supabase
    .from("recommendation")
    .select(COLUMNS)
    .eq("work_order_id", input.work_order_id)
    .eq("inspection_result_id", input.inspection_result_id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (linkedError) throw linkedError;
  const existing = linked as Recommendation | null;

  const plan = planRecommendationSyncForFinding(existing, input.status);

  if (plan.action === "create") {
    await createRecommendation(input.work_order_id, {
      description: `${input.item_name_snapshot} (${input.category_snapshot})`,
      severity: plan.severity,
      notes: input.notes ?? null,
      inspection_result_id: input.inspection_result_id,
    });
    return;
  }

  if (plan.action === "update_severity" && existing) {
    const { error } = await supabase
      .from("recommendation")
      .update({ severity: plan.severity })
      .eq("recommendation_id", existing.recommendation_id);
    if (error) throw error;
    return;
  }

  if (plan.action === "withdraw" && existing) {
    const { error } = await supabase
      .from("recommendation")
      .delete()
      .eq("recommendation_id", existing.recommendation_id)
      .eq("status", "pending");
    if (error) throw error;

    await addTimelineEvent(supabase, {
      work_order_id: input.work_order_id,
      user_id: user.user_id,
      event_type: TimelineEventType.RECOMMENDATION_WITHDRAWN,
      entity_type: "recommendation",
      entity_id: existing.recommendation_id,
      description: `Recommendation withdrawn (finding cleared): ${existing.description}`,
      old_value: { severity: existing.severity, status: existing.status },
    });
  }
}

/**
 * On inspection complete: create a pending recommendation for every yellow/red
 * finding that does not already have one linked.
 */
export async function ensureRecommendationsForAttentionFindings(
  workOrderId: string,
  findings: AttentionFindingInput[]
): Promise<number> {
  const attention = findings.filter((f) => isAttentionInspectionStatus(f.status));
  if (attention.length === 0) return 0;

  const user = await requireUser();
  if (!canCreateRecommendation(user.role)) throw new Error("FORBIDDEN");

  const { supabase } = await requireMutableWorkOrder(user, workOrderId);

  const resultIds = attention.map((f) => f.inspection_result_id);
  const { data: existing, error: existingError } = await supabase
    .from("recommendation")
    .select("inspection_result_id")
    .eq("work_order_id", workOrderId)
    .in("inspection_result_id", resultIds);
  if (existingError) throw existingError;

  const already = new Set(
    (existing ?? [])
      .map((row) => row.inspection_result_id as string | null)
      .filter((id): id is string => Boolean(id))
  );

  let created = 0;
  for (const finding of attention) {
    if (already.has(finding.inspection_result_id)) continue;
    await createRecommendation(workOrderId, {
      description: `${finding.item_name_snapshot} (${finding.category_snapshot})`,
      severity: severityFromInspectionStatus(finding.status as InspectionResultStatus),
      notes: finding.notes ?? null,
      inspection_result_id: finding.inspection_result_id,
    });
    created += 1;
  }
  return created;
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
  if (workOrder.status === "completed" || workOrder.status === "cancelled") {
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

export type RecommendationEstimatePart = {
  part_id: string;
  part_name: string;
  quantity: number;
  unit_price: number | null;
  status: string;
};

export type RecommendationEstimateLine = {
  recommendation_id: string;
  job_id: string;
  title: string;
  severity: RecommendationSeverity;
  job_status: JobStatus;
  labour_price: number | null;
  parts: RecommendationEstimatePart[];
  parts_total: number;
  line_total: number;
};

/**
 * Estimate lines for the work order's recommendation summary: every
 * recommendation converted to a job that is still waiting for the client,
 * with the job's labour price and its parts (retail pricing).
 */
export async function listRecommendationEstimateLines(
  workOrderId: string
): Promise<RecommendationEstimateLine[]> {
  await requireUser();
  const supabase = await createClient();

  const { data: recs, error: recError } = await supabase
    .from("recommendation")
    .select("recommendation_id, severity, converted_job_id")
    .eq("work_order_id", workOrderId)
    .not("converted_job_id", "is", null);
  if (recError) throw recError;

  const jobIds = (recs ?? [])
    .map((r) => r.converted_job_id as string | null)
    .filter((id): id is string => Boolean(id));
  if (jobIds.length === 0) return [];

  const { data: jobs, error: jobError } = await supabase
    .from("job")
    .select("job_id, service_name_snapshot, status, standard_price_snapshot")
    .in("job_id", jobIds)
    .eq("status", "waiting_for_approval");
  if (jobError) throw jobError;
  if (!jobs || jobs.length === 0) return [];

  const { data: parts, error: partError } = await supabase
    .from("part")
    .select("part_id, job_id, part_name, quantity, unit_price, status")
    .in(
      "job_id",
      jobs.map((j) => j.job_id)
    )
    .not("status", "in", '("cancelled","not_required")');
  if (partError) throw partError;

  const partsByJob = new Map<string, RecommendationEstimatePart[]>();
  for (const part of parts ?? []) {
    const list = partsByJob.get(part.job_id as string) ?? [];
    list.push({
      part_id: part.part_id as string,
      part_name: part.part_name as string,
      quantity: Number(part.quantity ?? 0),
      unit_price: part.unit_price === null ? null : Number(part.unit_price),
      status: part.status as string,
    });
    partsByJob.set(part.job_id as string, list);
  }

  const jobById = new Map(jobs.map((j) => [j.job_id as string, j]));

  return (recs ?? [])
    .filter((rec) => jobById.has(rec.converted_job_id as string))
    .map((rec) => {
      const job = jobById.get(rec.converted_job_id as string)!;
      const jobParts = partsByJob.get(job.job_id as string) ?? [];
      const partsTotal = jobParts.reduce(
        (sum, p) => sum + (p.unit_price ?? 0) * p.quantity,
        0
      );
      const labour =
        job.standard_price_snapshot === null ? null : Number(job.standard_price_snapshot);
      return {
        recommendation_id: rec.recommendation_id as string,
        job_id: job.job_id as string,
        title: job.service_name_snapshot as string,
        severity: rec.severity as RecommendationSeverity,
        job_status: job.status as JobStatus,
        labour_price: labour,
        parts: jobParts,
        parts_total: partsTotal,
        line_total: (labour ?? 0) + partsTotal,
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
  const { supabase, locationId, workOrderNumber } = await requireMutableWorkOrder(
    user,
    workOrderId
  );

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

export async function createRecommendationFromInspectionResult(
  inspectionResultId: string,
  input: {
    description?: string;
    severity?: RecommendationSeverity;
    notes?: string | null;
  } = {}
): Promise<Recommendation> {
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
  if (!canRecordCustomerApproval(user.role) && !canCreateRecommendation(user.role)) {
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

  // Decline / defer: recalc from jobs only — no new work, finished path kept.
  // Pending recs are never auto-cleared; only this explicit decision resolves them.
  const { recalculateWorkOrderStatus } =
    await import("@/lib/status/recalculateWorkOrderStatus");
  await recalculateWorkOrderStatus(supabase, existing.work_order_id, user.user_id);

  return recommendation;
}

const CUSTOM_SERVICE_NAME = "Custom Service";

function jobTitleFromRecommendation(description: string, serviceName: string): string {
  const trimmed = description.trim();
  if (!trimmed) return serviceName;
  // Keep floor cards readable; full text stays in job notes / work brief.
  return trimmed.length > 80 ? `${trimmed.slice(0, 77)}…` : trimmed;
}

async function resolveServiceForRecommendation(
  supabase: Awaited<ReturnType<typeof createClient>>,
  serviceId?: string | null
) {
  if (serviceId) {
    const { data: service, error } = await supabase
      .from("service")
      .select("service_id, name, standard_price, estimated_labour, active")
      .eq("service_id", serviceId)
      .maybeSingle();
    if (error) throw error;
    if (!service || !service.active) throw new Error("SERVICE_NOT_FOUND");
    return service;
  }

  const { data: custom, error: customError } = await supabase
    .from("service")
    .select("service_id, name, standard_price, estimated_labour, active")
    .eq("name", CUSTOM_SERVICE_NAME)
    .eq("active", true)
    .maybeSingle();
  if (customError) throw customError;
  if (!custom) throw new Error("SERVICE_NOT_FOUND");
  return custom;
}

/** Prefer active tech, then who finished prior work on this WO, then primary. */
export function pickAssigneeForRecommendationJob(input: {
  activeTechnicianId: string | null | undefined;
  completedTechnicianId?: string | null | undefined;
  primaryTechnicianId: string | null | undefined;
}): string | null {
  return (
    input.activeTechnicianId ??
    input.completedTechnicianId ??
    input.primaryTechnicianId ??
    null
  );
}

/** True when approve must reopen a finished visit (QC / safety / pickup). */
export function workOrderNeedsReopenForNewRecommendationWork(wo: {
  quality_checked_at?: string | null;
  quality_checked_by_user_id?: string | null;
  safety_checked_at?: string | null;
  safety_checked_by_user_id?: string | null;
  ready_for_pickup_at?: string | null;
  status?: string | null;
}): boolean {
  return Boolean(
    wo.quality_checked_at ||
    wo.quality_checked_by_user_id ||
    wo.safety_checked_at ||
    wo.safety_checked_by_user_id ||
    wo.ready_for_pickup_at ||
    wo.status === "quality_check" ||
    wo.status === "safety_check" ||
    wo.status === "ready_for_pickup"
  );
}

/**
 * Approving new work after the visit finished must reopen the wrench flow:
 * clear QC / safety / pickup stamps so the WO is unfinished again.
 * Decline never calls this — finished state is preserved.
 */
export async function clearFinishedStampsForNewRecommendationWork(
  supabase: Awaited<ReturnType<typeof createClient>>,
  workOrderId: string
): Promise<boolean> {
  const { data: wo, error } = await supabase
    .from("work_order")
    .select(
      "quality_checked_at, quality_checked_by_user_id, safety_checked_at, safety_checked_by_user_id, ready_for_pickup_at, status"
    )
    .eq("work_order_id", workOrderId)
    .maybeSingle();
  if (error) throw error;
  if (!wo || !workOrderNeedsReopenForNewRecommendationWork(wo)) return false;

  const { error: clearError } = await supabase
    .from("work_order")
    .update({
      quality_checked_at: null,
      quality_checked_by_user_id: null,
      quality_check_notes: null,
      quality_check_assigned_to: null,
      safety_checked_at: null,
      safety_checked_by_user_id: null,
      safety_check_notes: null,
      ready_for_pickup_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("work_order_id", workOrderId);
  if (clearError) throw clearError;
  return true;
}

/**
 * Client approved a recommendation → create an approved job and put it on the
 * tech's docket as pending Perform work.
 */
export async function approveRecommendationAndSendToFloor(
  recommendationId: string,
  input: { service_id?: string | null } = {}
): Promise<{ job_id: string; recommendation_id: string }> {
  const user = await requireUser();
  if (!canRecordCustomerApproval(user.role) && !canConvertRecommendation(user.role)) {
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
  if (existing.status === "converted_to_job" || existing.converted_job_id) {
    throw new Error("RECOMMENDATION_ALREADY_CONVERTED");
  }
  if (existing.status === "declined") {
    throw new Error("RECOMMENDATION_DECLINED");
  }

  return convertRecommendationToJob(recommendationId, {
    service_id: input.service_id ?? undefined,
    already_approved: true,
    use_recommendation_title: true,
  });
}

export async function convertRecommendationToJob(
  recommendationId: string,
  input: {
    service_id?: string;
    already_approved?: boolean;
    /** Prefer recommendation description as the job/service label on the floor. */
    use_recommendation_title?: boolean;
    /** Quoted labour price for the estimate; overrides the catalogue price. */
    price_override?: number | null;
  }
): Promise<{ job_id: string; recommendation_id: string }> {
  const user = await requireUser();
  if (
    !canConvertRecommendation(user.role) &&
    !(input.already_approved && canRecordCustomerApproval(user.role))
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
  if (existing.status === "converted_to_job" || existing.converted_job_id) {
    throw new Error("RECOMMENDATION_ALREADY_CONVERTED");
  }

  const { locationId, workOrderNumber } = await requireMutableWorkOrder(
    user,
    existing.work_order_id
  );

  const service = await resolveServiceForRecommendation(supabase, input.service_id);

  const priceOverride =
    input.price_override === undefined || input.price_override === null
      ? null
      : Number(input.price_override);
  if (priceOverride !== null && (!Number.isFinite(priceOverride) || priceOverride < 0)) {
    throw new Error("INVALID_PRICE");
  }

  const alreadyApproved =
    Boolean(input.already_approved) || existing.status === "approved";
  const jobStatus: JobStatus = alreadyApproved ? "approved" : "waiting_for_approval";
  const serviceNameSnapshot =
    input.use_recommendation_title || service.name === CUSTOM_SERVICE_NAME
      ? jobTitleFromRecommendation(existing.description, service.name)
      : service.name;
  const jobNotes = [
    `From recommendation: ${existing.description}`,
    existing.notes?.trim() || null,
  ]
    .filter(Boolean)
    .join("\n\n");

  const { data: job, error: jobError } = await supabase
    .from("job")
    .insert({
      work_order_id: existing.work_order_id,
      service_id: service.service_id,
      service_name_snapshot: serviceNameSnapshot,
      standard_price_snapshot: priceOverride ?? service.standard_price,
      estimated_labour_snapshot: service.estimated_labour,
      status: jobStatus,
      created_by_user_id: user.user_id,
      notes: jobNotes,
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

  // Prefer tech on open work; if original job already finished, use that tech.
  const { data: activeTechJob } = await supabase
    .from("job")
    .select("assigned_technician_id")
    .eq("work_order_id", existing.work_order_id)
    .not("assigned_technician_id", "is", null)
    .not("status", "in", '("completed","cancelled","declined")')
    .neq("job_id", job.job_id)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const { data: completedTechJob } = await supabase
    .from("job")
    .select("assigned_technician_id")
    .eq("work_order_id", existing.work_order_id)
    .eq("status", "completed")
    .not("assigned_technician_id", "is", null)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const { data: woPrimary } = await supabase
    .from("work_order")
    .select("primary_technician_id")
    .eq("work_order_id", existing.work_order_id)
    .maybeSingle();
  const assigneeId = pickAssigneeForRecommendationJob({
    activeTechnicianId: activeTechJob?.assigned_technician_id as string | null,
    completedTechnicianId: completedTechJob?.assigned_technician_id as string | null,
    primaryTechnicianId: woPrimary?.primary_technician_id as string | null,
  });
  if (assigneeId) {
    await assignTechnicianToJob(job.job_id, assigneeId);
  }

  // Ensure Perform work checklist exists so the new docket job is ready to open.
  const { listJobChecklist } = await import("@/lib/services/jobChecklist");
  await listJobChecklist(job.job_id, supabase);

  // Approve after finish → unfinished again (clear QC/safety/pickup stamps).
  if (alreadyApproved) {
    await clearFinishedStampsForNewRecommendationWork(supabase, existing.work_order_id);
  }

  await recalculateWorkOrderStatus(supabase, existing.work_order_id, user.user_id);

  return {
    job_id: job.job_id,
    recommendation_id: recommendationId,
  };
}
