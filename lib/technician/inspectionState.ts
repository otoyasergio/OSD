export type InspectionCompletionRelation =
  | { completed_at: string | null }
  | Array<{ completed_at: string | null }>
  | null
  | undefined;

export function hasCompletedInspection(
  inspection: InspectionCompletionRelation
): boolean {
  const row = Array.isArray(inspection) ? inspection[0] : inspection;
  return Boolean(row?.completed_at);
}
