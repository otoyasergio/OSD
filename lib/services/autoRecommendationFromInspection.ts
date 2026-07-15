import type {
  InspectionResultStatus,
  RecommendationSeverity,
} from "@/lib/database/types";

/** Yellow/red inspection statuses should become pending recommendations. */
export function shouldAutoCreateRecommendation(
  status: InspectionResultStatus | null | undefined
): boolean {
  return status === "future_attention" || status === "immediate_attention";
}

export function severityFromInspectionStatus(
  status: InspectionResultStatus | null
): RecommendationSeverity {
  if (status === "immediate_attention") return "immediate_attention";
  return "future_attention";
}

/**
 * Idempotency: if a recommendation already links this inspection_result_id,
 * do not create another.
 */
export function shouldSkipDuplicateRecommendation(
  existingInspectionResultIds: Iterable<string>,
  inspectionResultId: string
): boolean {
  for (const id of existingInspectionResultIds) {
    if (id === inspectionResultId) return true;
  }
  return false;
}
