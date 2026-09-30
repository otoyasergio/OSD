"use client";

import type {
  OutstandingRecommendation,
  Recommendation,
  RecommendationEstimateLine,
} from "@/lib/services/recommendations";
import type { Service } from "@/lib/services/serviceCatalogueShared";
import type { RecommendationFormState } from "@/app/(app)/work_orders/recommendation-actions";
import {
  RecommendationCard,
  RecommendationCreateForm,
} from "@/components/recommendations/RecommendationCard";
import { OutstandingRecommendations } from "@/components/recommendations/OutstandingRecommendations";
import { RecommendationsSummary } from "@/components/recommendations/RecommendationsSummary";

type Action = (
  state: RecommendationFormState,
  formData: FormData
) => Promise<RecommendationFormState>;

// Server action curried with work_order_id; recommendationId is bound
// client-side so no function factory has to cross the RSC boundary.
type RecommendationAction = (
  recommendationId: string,
  state: RecommendationFormState,
  formData: FormData
) => Promise<RecommendationFormState>;

export function RecommendationsTab({
  recommendations,
  outstandingRecommendations = [],
  estimateLines = [],
  services,
  readOnly,
  canCreate,
  canUpdateStatus,
  canConvert,
  createAction,
  statusActionFor,
  convertActionFor,
  sendEstimateAction,
  fromResultId,
  fromResultDefaults,
}: {
  recommendations: Recommendation[];
  outstandingRecommendations?: OutstandingRecommendation[];
  estimateLines?: RecommendationEstimateLine[];
  services: Service[];
  readOnly: boolean;
  canCreate: boolean;
  canUpdateStatus: boolean;
  canConvert: boolean;
  createAction: Action;
  statusActionFor: RecommendationAction;
  convertActionFor: RecommendationAction;
  sendEstimateAction: Action;
  fromResultId?: string | null;
  fromResultDefaults?: {
    description: string;
    severity: string;
  } | null;
}) {
  return (
    <div className="flex flex-col gap-6">
      <RecommendationsSummary
        recommendations={recommendations}
        estimateLines={estimateLines}
        canSendEstimate={!readOnly && canConvert}
        sendEstimateAction={sendEstimateAction}
      />

      <OutstandingRecommendations
        recommendations={outstandingRecommendations}
        title="Previously deferred on this motorcycle"
        hideWhenEmpty
      />

      <div className="flex flex-col gap-4">
        {!readOnly && canCreate ? (
          <RecommendationCreateForm
            action={createAction}
            inspectionResultId={fromResultId}
            defaultDescription={fromResultDefaults?.description}
            defaultSeverity={fromResultDefaults?.severity}
          />
        ) : null}

        {recommendations.length === 0 ? (
          <p className="rounded border border-dashed border-[var(--border-strong)] bg-white px-4 py-10 text-center text-[var(--status-neutral)]">
            No recommendations yet.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {recommendations.map((recommendation) => (
              <RecommendationCard
                key={recommendation.recommendation_id}
                recommendation={recommendation}
                services={services}
                readOnly={readOnly}
                canUpdateStatus={canUpdateStatus}
                canConvert={canConvert}
                statusAction={statusActionFor.bind(
                  null,
                  recommendation.recommendation_id
                )}
                convertAction={convertActionFor.bind(
                  null,
                  recommendation.recommendation_id
                )}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
