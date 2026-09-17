"use client";

import { useActionState } from "react";
import type { Recommendation } from "@/lib/services/recommendations";
import type { EstimateFormState } from "@/app/(app)/work_orders/estimate-actions";
import type { RecommendationFormState } from "@/app/(app)/work_orders/recommendation-actions";
import { RECOMMENDATION_SEVERITY_LABELS } from "@/lib/status/labels";
import { StageChip } from "@/components/ui/StageChip";
import { FormError } from "@/components/forms/Field";
import { SubmitButton } from "@/components/forms/SubmitButton";

type EstimateAction = (
  state: EstimateFormState,
  formData: FormData
) => Promise<EstimateFormState>;

type LegacyAction = (
  state: RecommendationFormState,
  formData: FormData
) => Promise<RecommendationFormState>;

function severityTone(severity: Recommendation["severity"]) {
  if (severity === "safety_critical") return "danger" as const;
  if (severity === "immediate_attention") return "orange" as const;
  return "muted" as const;
}

function InboxRow({
  recommendation,
  addAction,
  statusAction,
  canAdd,
  canUpdateStatus,
}: {
  recommendation: Recommendation;
  addAction: EstimateAction;
  statusAction: LegacyAction;
  canAdd: boolean;
  canUpdateStatus: boolean;
}) {
  const [addState, addFormAction] = useActionState(addAction, { error: null });
  const [statusState, statusFormAction] = useActionState(statusAction, {
    error: null,
  });

  return (
    <li className="flex flex-col gap-2 rounded border border-[var(--border)] bg-white px-3 py-2">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-[var(--foreground)]">
            {recommendation.description}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <StageChip
              label={RECOMMENDATION_SEVERITY_LABELS[recommendation.severity]}
              tone={severityTone(recommendation.severity)}
            />
            {recommendation.inspection_result ? (
              <span className="text-xs text-[var(--status-neutral)]">
                From inspection: {recommendation.inspection_result.item_name_snapshot}
              </span>
            ) : null}
          </div>
          {recommendation.notes ? (
            <p className="mt-1 text-xs text-[var(--status-neutral)]">
              {recommendation.notes}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canAdd ? (
            <form action={addFormAction} className="inline">
              <SubmitButton label="Add to estimate" pendingLabel="Adding…" />
            </form>
          ) : null}
          {canUpdateStatus ? (
            <>
              <form action={statusFormAction} className="inline">
                <input type="hidden" name="status" value="deferred" />
                <button type="submit" className="btn btn-secondary">
                  Defer
                </button>
              </form>
              <form action={statusFormAction} className="inline">
                <input type="hidden" name="status" value="declined" />
                <button type="submit" className="btn btn-secondary">
                  Decline
                </button>
              </form>
            </>
          ) : null}
        </div>
      </div>
      <FormError message={addState.error} />
      <FormError message={statusState.error} />
    </li>
  );
}

/**
 * Open findings/advisories awaiting a staff decision. "Add to estimate"
 * creates a DRAFT job (never approved) so it can be priced and presented;
 * customer authorization only ever happens through estimate confirmation.
 */
export function RecommendationInbox({
  recommendations,
  addActionFor,
  statusActionFor,
  canAdd,
  canUpdateStatus,
}: {
  recommendations: Recommendation[];
  addActionFor: (
    recommendationId: string,
    state: EstimateFormState,
    formData: FormData
  ) => Promise<EstimateFormState>;
  statusActionFor: (
    recommendationId: string,
    state: RecommendationFormState,
    formData: FormData
  ) => Promise<RecommendationFormState>;
  canAdd: boolean;
  canUpdateStatus: boolean;
}) {
  return (
    <section aria-label="Recommendation inbox" className="card card-body">
      <h3 className="text-base font-semibold text-[var(--foreground)]">
        Findings awaiting a decision
      </h3>
      <p className="mt-1 text-sm text-[var(--status-neutral)]">
        Add a finding to the estimate to price it, or defer / decline it for the record.
      </p>
      {recommendations.length === 0 ? (
        <p className="mt-3 rounded border border-dashed border-[var(--border-strong)] bg-white px-4 py-6 text-center text-sm text-[var(--status-neutral)]">
          Nothing waiting — new inspection findings land here automatically.
        </p>
      ) : (
        <ul className="mt-3 flex flex-col gap-2">
          {recommendations.map((recommendation) => (
            <InboxRow
              key={recommendation.recommendation_id}
              recommendation={recommendation}
              addAction={addActionFor.bind(null, recommendation.recommendation_id)}
              statusAction={statusActionFor.bind(null, recommendation.recommendation_id)}
              canAdd={canAdd}
              canUpdateStatus={canUpdateStatus}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
