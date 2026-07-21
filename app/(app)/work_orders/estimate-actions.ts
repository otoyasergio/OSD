"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/database/supabase-server";
import { readWorkflowV2Flags, v2WritesEnabled } from "@/lib/config/features";
import { confirmEstimate, presentEstimate } from "@/lib/services/estimates";
import { createDraftJobFromRecommendation } from "@/lib/services/recommendations";
import { toFormErrorMessage } from "@/lib/services/errors";
import { addTimelineEvent } from "@/lib/timeline/addTimelineEvent";
import { TimelineEventType } from "@/lib/timeline/events";
import { confirmEstimateSchema, presentEstimateSchema } from "@/lib/validation/schemas";
import type { EstimateJobDraft } from "@/lib/services/estimatePricing";

export type EstimateFormState = { error: string | null };

const ESTIMATE_ERROR_MESSAGES: Record<string, string> = {
  ESTIMATE_EMPTY: "Add at least one job before presenting the estimate.",
  ESTIMATE_MISSING_PRICES:
    "Every part and package needs a price before presenting. Set retail prices on the Parts tab.",
  ESTIMATE_NEGATIVE_TOTAL: "The estimate total cannot be negative.",
  ESTIMATE_VERSION_NOT_FOUND: "That estimate version no longer exists.",
  ESTIMATE_NOT_PRESENTED: "Present the estimate before recording decisions.",
  ESTIMATE_ALREADY_CONFIRMED:
    "This version is already confirmed. Refresh to see the recorded decisions.",
  ESTIMATE_CONTENT_STALE:
    "The estimate changed since this page loaded. Refresh and try again.",
  DECISION_MISSING: "Record a decision for every job on the estimate.",
  DECISION_FOR_UNKNOWN_JOB:
    "One of the decisions no longer matches the presented estimate. Refresh and try again.",
  DUPLICATE_DECISION: "Duplicate decision for a job. Refresh and try again.",
  V2_WRITES_DISABLED: "Estimate presentation is not enabled for this environment yet.",
};

function toEstimateError(error: unknown): string {
  if (error instanceof Error && ESTIMATE_ERROR_MESSAGES[error.message]) {
    return ESTIMATE_ERROR_MESSAGES[error.message];
  }
  return toFormErrorMessage(error);
}

function assertV2Writes(): void {
  if (!v2WritesEnabled(readWorkflowV2Flags())) {
    throw new Error("V2_WRITES_DISABLED");
  }
}

function parseJsonField(formData: FormData, key: string): unknown {
  const raw = String(formData.get(key) ?? "");
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function revalidateEstimate(workOrderId: string) {
  revalidatePath(`/work_orders/${workOrderId}`);
  revalidatePath("/work_orders");
  revalidatePath("/dashboard");
  revalidatePath("/technician");
  revalidatePath("/billing");
}

export async function presentEstimateAction(
  workOrderId: string,
  _prevState: EstimateFormState,
  formData: FormData
): Promise<EstimateFormState> {
  try {
    assertV2Writes();
    const parsed = presentEstimateSchema.parse({
      drafts: parseJsonField(formData, "drafts"),
    });

    const { estimateVersionId, snapshot } = await presentEstimate(
      workOrderId,
      parsed.drafts as EstimateJobDraft[]
    );

    const user = await requireUser();
    const supabase = await createClient();
    await addTimelineEvent(supabase, {
      work_order_id: workOrderId,
      user_id: user.user_id,
      event_type: TimelineEventType.ESTIMATE_PRESENTED,
      entity_type: "estimate_version",
      entity_id: estimateVersionId,
      description: `Estimate presented (${snapshot.jobs.length} job${
        snapshot.jobs.length === 1 ? "" : "s"
      }, $${(snapshot.totals.totalCents / 100).toFixed(2)})`,
      new_value: {
        total_cents: snapshot.totals.totalCents,
        content_hash: snapshot.contentHash,
      },
    });
  } catch (error) {
    return { error: toEstimateError(error) };
  }

  revalidateEstimate(workOrderId);
  return { error: null };
}

export async function confirmEstimateAction(
  workOrderId: string,
  _prevState: EstimateFormState,
  formData: FormData
): Promise<EstimateFormState> {
  try {
    assertV2Writes();
    const parsed = confirmEstimateSchema.parse({
      estimateVersionId: String(formData.get("estimate_version_id") ?? ""),
      expectedContentHash: String(formData.get("expected_content_hash") ?? ""),
      method: String(formData.get("method") ?? ""),
      decisions: parseJsonField(formData, "decisions"),
    });

    await confirmEstimate({
      estimateVersionId: parsed.estimateVersionId,
      decisions: parsed.decisions,
      expectedContentHash: parsed.expectedContentHash,
      actorType: "staff",
      method: parsed.method,
    });

    const user = await requireUser();
    const supabase = await createClient();
    const approved = parsed.decisions.filter((d) => d.decision === "approved").length;
    await addTimelineEvent(supabase, {
      work_order_id: workOrderId,
      user_id: user.user_id,
      event_type: TimelineEventType.ESTIMATE_CONFIRMED,
      entity_type: "estimate",
      entity_id: parsed.estimateVersionId,
      description: `Customer decisions recorded (${approved}/${parsed.decisions.length} approved, ${parsed.method})`,
      new_value: { decisions: parsed.decisions, method: parsed.method },
    });
  } catch (error) {
    return { error: toEstimateError(error) };
  }

  revalidateEstimate(workOrderId);
  return { error: null };
}

export async function addRecommendationToEstimateAction(
  workOrderId: string,
  recommendationId: string,
  _prevState: EstimateFormState,
  formData: FormData
): Promise<EstimateFormState> {
  void formData;
  try {
    assertV2Writes();
    await createDraftJobFromRecommendation(recommendationId);
  } catch (error) {
    return { error: toEstimateError(error) };
  }

  revalidateEstimate(workOrderId);
  return { error: null };
}
