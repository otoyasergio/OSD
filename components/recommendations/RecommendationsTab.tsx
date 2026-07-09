"use client";

import type { Recommendation } from "@/lib/services/recommendations";
import type { Service } from "@/lib/services/serviceCatalogue";
import type { RecommendationFormState } from "@/app/(app)/work_orders/recommendation-actions";
import {
  RecommendationCard,
  RecommendationCreateForm,
} from "@/components/recommendations/RecommendationCard";

type Action = (
  state: RecommendationFormState,
  formData: FormData
) => Promise<RecommendationFormState>;

export function RecommendationsTab({
  recommendations,
  services,
  readOnly,
  canCreate,
  canUpdateStatus,
  canConvert,
  createAction,
  statusActionFor,
  convertActionFor,
  fromResultId,
  fromResultDefaults,
}: {
  recommendations: Recommendation[];
  services: Service[];
  readOnly: boolean;
  canCreate: boolean;
  canUpdateStatus: boolean;
  canConvert: boolean;
  createAction: Action;
  statusActionFor: (recommendationId: string) => Action;
  convertActionFor: (recommendationId: string) => Action;
  fromResultId?: string | null;
  fromResultDefaults?: {
    description: string;
    severity: string;
  } | null;
}) {
  return (
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
        <p className="rounded border border-dashed border-zinc-300 bg-white px-4 py-10 text-center text-zinc-600">
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
              statusAction={statusActionFor(recommendation.recommendation_id)}
              convertAction={convertActionFor(recommendation.recommendation_id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
