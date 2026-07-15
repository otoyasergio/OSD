import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/database/supabase-server";
import type {
  DbClient,
  RecommendationSeverity,
  WorkOrderStatus,
} from "@/lib/database/types";
import { addAuditLog } from "@/lib/audit/addAuditLog";
import { addTimelineEvent } from "@/lib/timeline/addTimelineEvent";
import { TimelineEventType } from "@/lib/timeline/events";
import { canOverrideSafetyRequirement, canPerformSafetyCheck } from "@/lib/permissions";
import { recalculateWorkOrderStatus } from "@/lib/status/recalculateWorkOrderStatus";
import { SAFETY_INSPECTION_SERVICE_NAME } from "@/lib/status/safetyRequired";

type WorkOrderRow = {
  work_order_id: string;
  location_id: string;
  work_order_number: string;
  status: WorkOrderStatus;
  safety_checked_at: string | null;
  safety_checked_by_user_id: string | null;
  safety_required: boolean | null;
  safety_waived: boolean;
};

export type SafetyFailRecommendationInput = {
  description: string;
  severity: RecommendationSeverity;
  notes?: string | null;
};

async function loadWorkOrder(
  supabase: DbClient,
  workOrderId: string
): Promise<WorkOrderRow | null> {
  const { data, error } = await supabase
    .from("work_order")
    .select(
      "work_order_id, location_id, work_order_number, status, safety_checked_at, safety_checked_by_user_id, safety_required, safety_waived"
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
  if (workOrder.location_id !== user.active_location_id) {
    throw new Error("FOREIGN_LOCATION");
  }
  if (workOrder.status === "completed" || workOrder.status === "cancelled") {
    throw new Error("WORK_ORDER_LOCKED");
  }
  return { user, supabase, workOrder };
}

async function resolveFallbackServiceId(supabase: DbClient): Promise<{
  service_id: string;
  name: string;
  standard_price: number | null;
  estimated_labour: number | null;
}> {
  const { data: safetyService, error: safetyError } = await supabase
    .from("service")
    .select("service_id, name, standard_price, estimated_labour")
    .eq("name", SAFETY_INSPECTION_SERVICE_NAME)
    .eq("active", true)
    .maybeSingle();
  if (safetyError) throw safetyError;
  if (safetyService) {
    return safetyService as {
      service_id: string;
      name: string;
      standard_price: number | null;
      estimated_labour: number | null;
    };
  }

  const { data: anyService, error } = await supabase
    .from("service")
    .select("service_id, name, standard_price, estimated_labour")
    .eq("active", true)
    .order("name")
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!anyService) throw new Error("SERVICE_NOT_FOUND");
  return anyService as {
    service_id: string;
    name: string;
    standard_price: number | null;
    estimated_labour: number | null;
  };
}

export async function passSafetyCheck(
  workOrderId: string,
  notes?: string | null
): Promise<void> {
  const { user, supabase, workOrder } = await requireMutableWorkOrder(workOrderId);
  if (!canPerformSafetyCheck(user.role)) throw new Error("FORBIDDEN");
  if (workOrder.status !== "safety_check") throw new Error("INVALID_STATUS");

  const now = new Date().toISOString();
  const trimmedNotes = notes?.trim() || null;

  const { error } = await supabase
    .from("work_order")
    .update({
      safety_checked_by_user_id: user.user_id,
      safety_checked_at: now,
      safety_check_notes: trimmedNotes,
      updated_at: now,
    })
    .eq("work_order_id", workOrderId);
  if (error) throw error;

  await addTimelineEvent(supabase, {
    work_order_id: workOrderId,
    user_id: user.user_id,
    event_type: TimelineEventType.SAFETY_CHECK_PASSED,
    entity_type: "work_order",
    entity_id: workOrderId,
    description: "Safety check passed",
    old_value: {
      safety_checked_at: workOrder.safety_checked_at,
      safety_checked_by_user_id: workOrder.safety_checked_by_user_id,
    },
    new_value: {
      safety_checked_at: now,
      safety_checked_by_user_id: user.user_id,
      safety_check_notes: trimmedNotes,
    },
  });

  await addAuditLog(supabase, {
    actor_user_id: user.user_id,
    location_id: workOrder.location_id,
    action: "safety_check_passed",
    entity_type: "work_order",
    entity_id: workOrderId,
    description: `Safety check passed on ${workOrder.work_order_number}`,
    new_value: { safety_checked_at: now, safety_check_notes: trimmedNotes },
  });

  await recalculateWorkOrderStatus(supabase, workOrderId, user.user_id);
}

export async function failSafetyCheck(
  workOrderId: string,
  input: {
    notes?: string | null;
    recommendations: SafetyFailRecommendationInput[];
  }
): Promise<void> {
  const { user, supabase, workOrder } = await requireMutableWorkOrder(workOrderId);
  if (!canPerformSafetyCheck(user.role)) throw new Error("FORBIDDEN");
  if (workOrder.status !== "safety_check") throw new Error("INVALID_STATUS");

  const recommendations = input.recommendations
    .map((rec) => ({
      description: rec.description.trim(),
      severity: rec.severity,
      notes: rec.notes?.trim() || null,
    }))
    .filter((rec) => rec.description.length > 0);

  if (recommendations.length === 0) {
    throw new Error("SAFETY_FAIL_RECOMMENDATIONS_REQUIRED");
  }

  const fallbackService = await resolveFallbackServiceId(supabase);
  const now = new Date().toISOString();
  const trimmedNotes = input.notes?.trim() || null;

  for (const rec of recommendations) {
    const { data: recommendation, error: recError } = await supabase
      .from("recommendation")
      .insert({
        work_order_id: workOrderId,
        created_by_user_id: user.user_id,
        description: rec.description,
        severity: rec.severity,
        notes: rec.notes,
        status: "pending",
      })
      .select("recommendation_id")
      .single();
    if (recError) throw recError;

    const { data: job, error: jobError } = await supabase
      .from("job")
      .insert({
        work_order_id: workOrderId,
        service_id: fallbackService.service_id,
        service_name_snapshot: rec.description,
        status: "waiting_for_approval",
        price_snapshot: fallbackService.standard_price,
        estimated_labour_snapshot: fallbackService.estimated_labour,
        created_by_user_id: user.user_id,
      })
      .select("job_id")
      .single();
    if (jobError) throw jobError;

    const { error: linkError } = await supabase
      .from("recommendation")
      .update({
        status: "converted_to_job",
        converted_job_id: job.job_id,
        resolved_at: now,
      })
      .eq("recommendation_id", recommendation.recommendation_id);
    if (linkError) throw linkError;

    await addTimelineEvent(supabase, {
      work_order_id: workOrderId,
      user_id: user.user_id,
      event_type: TimelineEventType.RECOMMENDATION_CREATED,
      entity_type: "recommendation",
      entity_id: recommendation.recommendation_id,
      description: `Safety fail recommendation: ${rec.description}`,
      new_value: { severity: rec.severity, status: "converted_to_job" },
    });
  }

  const { error: clearError } = await supabase
    .from("work_order")
    .update({
      quality_checked_at: null,
      quality_checked_by_user_id: null,
      quality_check_notes: null,
      quality_check_assigned_to: null,
      safety_checked_at: null,
      safety_checked_by_user_id: null,
      safety_check_notes: trimmedNotes,
      updated_at: now,
    })
    .eq("work_order_id", workOrderId);
  if (clearError) throw clearError;

  await addTimelineEvent(supabase, {
    work_order_id: workOrderId,
    user_id: user.user_id,
    event_type: TimelineEventType.SAFETY_CHECK_FAILED,
    entity_type: "work_order",
    entity_id: workOrderId,
    description: "Safety check failed — returned for customer approval",
    new_value: {
      recommendation_count: recommendations.length,
      safety_check_notes: trimmedNotes,
    },
  });

  await addAuditLog(supabase, {
    actor_user_id: user.user_id,
    location_id: workOrder.location_id,
    action: "safety_check_failed",
    entity_type: "work_order",
    entity_id: workOrderId,
    description: `Safety check failed on ${workOrder.work_order_number}`,
    new_value: {
      recommendation_count: recommendations.length,
      safety_check_notes: trimmedNotes,
    },
  });

  await recalculateWorkOrderStatus(supabase, workOrderId, user.user_id);
}

export async function overrideSafetyRequirement(
  workOrderId: string,
  input: { require?: boolean; waive?: boolean }
): Promise<void> {
  const { user, supabase, workOrder } = await requireMutableWorkOrder(workOrderId);
  if (!canOverrideSafetyRequirement(user.role)) throw new Error("FORBIDDEN");

  const nextRequired =
    input.require === undefined ? workOrder.safety_required : input.require ? true : null;
  const nextWaived =
    input.waive === undefined ? workOrder.safety_waived : Boolean(input.waive);

  // Waive and force are mutually exclusive when explicitly set.
  const safety_required = nextWaived ? null : nextRequired;
  const safety_waived = nextWaived;

  const now = new Date().toISOString();
  const { error } = await supabase
    .from("work_order")
    .update({
      safety_required,
      safety_waived,
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
    description: safety_waived
      ? "Safety requirement waived"
      : safety_required
        ? "Safety requirement forced on"
        : "Safety requirement reset to default",
    old_value: {
      safety_required: workOrder.safety_required,
      safety_waived: workOrder.safety_waived,
    },
    new_value: { safety_required, safety_waived },
  });

  await addAuditLog(supabase, {
    actor_user_id: user.user_id,
    location_id: workOrder.location_id,
    action: "safety_requirement_overridden",
    entity_type: "work_order",
    entity_id: workOrderId,
    description: `Safety requirement updated on ${workOrder.work_order_number}`,
    old_value: {
      safety_required: workOrder.safety_required,
      safety_waived: workOrder.safety_waived,
    },
    new_value: { safety_required, safety_waived },
  });

  await recalculateWorkOrderStatus(supabase, workOrderId, user.user_id);
}
