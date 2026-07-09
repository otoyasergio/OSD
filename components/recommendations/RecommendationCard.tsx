"use client";

import { useActionState, useState } from "react";
import type { Recommendation } from "@/lib/services/recommendations";
import type { Service } from "@/lib/services/serviceCatalogueShared";
import type { RecommendationFormState } from "@/app/(app)/work_orders/recommendation-actions";
import {
  RECOMMENDATION_SEVERITY_LABELS,
  RECOMMENDATION_STATUS_LABELS,
} from "@/lib/status/labels";
import { FormError, TextAreaField, TextField } from "@/components/forms/Field";
import { SubmitButton } from "@/components/forms/SubmitButton";

type Action = (
  state: RecommendationFormState,
  formData: FormData
) => Promise<RecommendationFormState>;

const SELECT_CLASS =
  "min-h-11 w-full rounded border border-zinc-300 bg-white px-3 py-2 text-base text-zinc-900 outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10";

const SEVERITY_OPTIONS = [
  "future_attention",
  "immediate_attention",
  "safety_critical",
] as const;

export function RecommendationCreateForm({
  action,
  defaultDescription = "",
  defaultSeverity = "future_attention",
  inspectionResultId,
}: {
  action: Action;
  defaultDescription?: string;
  defaultSeverity?: string;
  inspectionResultId?: string | null;
}) {
  const [state, formAction] = useActionState(action, { error: null });

  return (
    <form
      action={formAction}
      className="flex flex-col gap-3 rounded border border-zinc-200 bg-white p-4"
    >
      <h3 className="text-base font-semibold text-zinc-900">
        New recommendation
      </h3>
      <FormError message={state.error} />
      {inspectionResultId ? (
        <input
          type="hidden"
          name="inspection_result_id"
          value={inspectionResultId}
        />
      ) : null}
      <TextField
        label="Description"
        name="description"
        required
        defaultValue={defaultDescription}
      />
      <label className="block">
        <span className="mb-1.5 block text-sm font-medium text-zinc-800">
          Severity <span className="text-red-600">*</span>
        </span>
        <select
          className={SELECT_CLASS}
          name="severity"
          required
          defaultValue={defaultSeverity}
        >
          {SEVERITY_OPTIONS.map((value) => (
            <option key={value} value={value}>
              {RECOMMENDATION_SEVERITY_LABELS[value]}
            </option>
          ))}
        </select>
      </label>
      <TextAreaField label="Notes" name="notes" rows={2} />
      <div>
        <SubmitButton label="Add recommendation" pendingLabel="Adding…" />
      </div>
    </form>
  );
}

export function RecommendationCard({
  recommendation,
  services,
  readOnly,
  canUpdateStatus,
  canConvert,
  statusAction,
  convertAction,
}: {
  recommendation: Recommendation;
  services: Service[];
  readOnly: boolean;
  canUpdateStatus: boolean;
  canConvert: boolean;
  statusAction: Action;
  convertAction: Action;
}) {
  const [showConvert, setShowConvert] = useState(false);
  const [statusState, statusFormAction] = useActionState(statusAction, {
    error: null,
  });
  const [convertState, convertFormAction] = useActionState(convertAction, {
    error: null,
  });

  const isSafety = recommendation.severity === "safety_critical";
  const isConverted = recommendation.status === "converted_to_job";
  const canAct =
    !readOnly &&
    !isConverted &&
    recommendation.status !== "declined";

  return (
    <article
      className={`rounded border p-4 ${
        isSafety
          ? "border-red-400 bg-red-50"
          : "border-zinc-200 bg-white"
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-zinc-900">
            {recommendation.description}
          </h3>
          <p className="mt-1 text-sm text-zinc-600">
            {RECOMMENDATION_SEVERITY_LABELS[recommendation.severity]} ·{" "}
            {RECOMMENDATION_STATUS_LABELS[recommendation.status]}
          </p>
          {recommendation.inspection_result ? (
            <p className="mt-1 text-sm text-zinc-500">
              From inspection:{" "}
              {recommendation.inspection_result.item_name_snapshot}
            </p>
          ) : null}
          {recommendation.notes ? (
            <p className="mt-2 text-sm text-zinc-700">{recommendation.notes}</p>
          ) : null}
          {isConverted && recommendation.converted_job_id ? (
            <p className="mt-2 text-sm font-medium text-emerald-800">
              Converted to job (kept for history)
            </p>
          ) : null}
        </div>
        {isSafety ? (
          <span className="rounded bg-red-600 px-2 py-1 text-xs font-bold uppercase tracking-wide text-white">
            Safety critical
          </span>
        ) : null}
      </div>

      {canAct ? (
        <div className="mt-4 flex flex-col gap-3">
          {canUpdateStatus ? (
            <div className="flex flex-wrap gap-2">
              {(["approved", "declined", "deferred"] as const).map((status) => (
                <form key={status} action={statusFormAction} className="inline">
                  <input type="hidden" name="status" value={status} />
                  <button
                    type="submit"
                    className="min-h-11 rounded border border-zinc-300 bg-white px-3 py-2 text-sm font-semibold text-zinc-800 hover:bg-zinc-100"
                  >
                    {RECOMMENDATION_STATUS_LABELS[status]}
                  </button>
                </form>
              ))}
              <FormError message={statusState.error} />
            </div>
          ) : null}

          {canConvert ? (
            <div>
              {!showConvert ? (
                <button
                  type="button"
                  onClick={() => setShowConvert(true)}
                  className="min-h-11 rounded border border-zinc-900 bg-zinc-900 px-3 py-2 text-sm font-semibold text-white hover:bg-zinc-800"
                >
                  Convert to job…
                </button>
              ) : (
                <form
                  action={convertFormAction}
                  className="flex flex-col gap-3 rounded border border-zinc-200 bg-white p-3"
                >
                  <label className="block">
                    <span className="mb-1.5 block text-sm font-medium text-zinc-800">
                      Service <span className="text-red-600">*</span>
                    </span>
                    <select
                      className={SELECT_CLASS}
                      name="service_id"
                      required
                      defaultValue=""
                    >
                      <option value="">Select service</option>
                      {services.map((service) => (
                        <option
                          key={service.service_id}
                          value={service.service_id}
                        >
                          {service.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      name="already_approved"
                      value="true"
                      className="h-4 w-4 rounded border-zinc-300"
                    />
                    <span className="text-sm text-zinc-800">
                      Already approved by customer
                    </span>
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <SubmitButton
                      label="Confirm convert"
                      pendingLabel="Converting…"
                    />
                    <button
                      type="button"
                      onClick={() => setShowConvert(false)}
                      className="min-h-11 rounded border border-zinc-300 bg-white px-3 py-2 text-sm font-semibold text-zinc-800"
                    >
                      Cancel
                    </button>
                  </div>
                  <FormError message={convertState.error} />
                </form>
              )}
            </div>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
