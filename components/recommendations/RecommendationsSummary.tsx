"use client";

import { useActionState } from "react";
import type {
  Recommendation,
  RecommendationEstimateLine,
} from "@/lib/services/recommendations";
import type { RecommendationFormState } from "@/app/(app)/work_orders/recommendation-actions";
import { RECOMMENDATION_SEVERITY_LABELS } from "@/lib/status/labels";
import { estimateTotalsWithHst, HST_PERCENT } from "@/lib/pricing/hst";
import { FormError } from "@/components/forms/Field";
import { SubmitButton } from "@/components/forms/SubmitButton";

type Action = (
  state: RecommendationFormState,
  formData: FormData
) => Promise<RecommendationFormState>;

function money(dollars: number): string {
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
  }).format(dollars);
}

function moneyCents(cents: number): string {
  return money(cents / 100);
}

const OPEN_STATUSES = new Set(["pending", "deferred"]);

export function RecommendationsSummary({
  recommendations,
  estimateLines,
  canSendEstimate,
  sendEstimateAction,
}: {
  recommendations: Recommendation[];
  estimateLines: RecommendationEstimateLine[];
  canSendEstimate: boolean;
  sendEstimateAction: Action;
}) {
  const [sendState, sendFormAction] = useActionState(sendEstimateAction, {
    error: null,
  });

  const open = recommendations.filter((r) => OPEN_STATUSES.has(r.status));
  const immediate = open.filter(
    (r) => r.severity === "immediate_attention" || r.severity === "safety_critical"
  ).length;
  const future = open.filter((r) => r.severity === "future_attention").length;
  const declined = recommendations.filter((r) => r.status === "declined").length;
  const converted = recommendations.filter(
    (r) => r.status === "converted_to_job" || r.status === "approved"
  ).length;

  const estimateSubtotal = estimateLines.reduce((sum, line) => sum + line.line_total, 0);
  const totals = estimateTotalsWithHst(estimateSubtotal);
  const missingPartPrices = estimateLines.some((line) =>
    line.parts.some((part) => part.unit_price === null)
  );

  return (
    <section
      aria-label="Recommendation summary"
      className="rounded border border-[var(--border)] bg-white p-4"
    >
      <h2 className="text-base font-semibold text-foreground">Client advisories</h2>
      <p className="mt-1 text-sm text-[var(--status-neutral)]">
        Everything the techs flagged on this bike, in one place.
      </p>

      <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded border border-red-200 bg-red-50 px-3 py-2">
          <dt className="text-xs font-medium uppercase tracking-wide text-red-800">
            {RECOMMENDATION_SEVERITY_LABELS.immediate_attention}
          </dt>
          <dd className="text-xl font-bold text-red-900">{immediate}</dd>
        </div>
        <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2">
          <dt className="text-xs font-medium uppercase tracking-wide text-amber-800">
            {RECOMMENDATION_SEVERITY_LABELS.future_attention}
          </dt>
          <dd className="text-xl font-bold text-amber-900">{future}</dd>
        </div>
        <div className="rounded border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2">
          <dt className="text-xs font-medium uppercase tracking-wide text-[var(--status-neutral)]">
            On estimate / approved
          </dt>
          <dd className="text-xl font-bold text-foreground">{converted}</dd>
        </div>
        <div className="rounded border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2">
          <dt className="text-xs font-medium uppercase tracking-wide text-[var(--status-neutral)]">
            Declined
          </dt>
          <dd className="text-xl font-bold text-foreground">{declined}</dd>
        </div>
      </dl>

      {estimateLines.length > 0 ? (
        <div className="mt-4 rounded border border-[var(--border)] bg-[var(--surface-muted)] p-3">
          <h3 className="text-sm font-semibold text-foreground">
            Estimate awaiting client approval
          </h3>
          <ul className="mt-2 flex flex-col gap-2">
            {estimateLines.map((line) => (
              <li
                key={line.job_id}
                className="rounded border border-[var(--border)] bg-white px-3 py-2"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-sm font-medium text-foreground">
                    {line.title}
                  </span>
                  <span className="text-sm font-semibold text-foreground">
                    {money(line.line_total)}
                  </span>
                </div>
                <p className="text-xs text-[var(--status-neutral)]">
                  Labour {line.labour_price === null ? "—" : money(line.labour_price)}
                  {line.parts.length > 0
                    ? ` · Parts ${money(line.parts_total)} (${line.parts.length})`
                    : " · No parts added yet"}
                </p>
                {line.parts.length > 0 ? (
                  <ul className="mt-1 text-xs text-[var(--status-neutral)]">
                    {line.parts.map((part) => (
                      <li key={part.part_id}>
                        {part.part_name} × {part.quantity} —{" "}
                        {part.unit_price === null
                          ? "price needed"
                          : money(part.unit_price * part.quantity)}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>

          <div className="mt-3 border-t border-[var(--border)] pt-2 text-sm">
            <div className="flex justify-between text-[var(--status-neutral)]">
              <span>Subtotal</span>
              <span>{moneyCents(totals.subtotalCents)}</span>
            </div>
            <div className="flex justify-between text-[var(--status-neutral)]">
              <span>HST ({HST_PERCENT}%)</span>
              <span>{moneyCents(totals.hstCents)}</span>
            </div>
            <div className="flex justify-between font-semibold text-foreground">
              <span>Estimate total</span>
              <span>{moneyCents(totals.totalCents)}</span>
            </div>
          </div>

          {missingPartPrices ? (
            <p className="mt-2 text-xs font-medium text-amber-800">
              Some parts are missing retail prices — set them on the Parts tab before
              sending.
            </p>
          ) : null}

          {canSendEstimate ? (
            <form
              action={sendFormAction}
              className="mt-3 flex flex-wrap items-center gap-2"
            >
              <SubmitButton label="Send estimate to client" pendingLabel="Sending…" />
              <label className="flex items-center gap-2 text-sm text-foreground">
                <select
                  name="channel"
                  defaultValue="email"
                  className="min-h-11 rounded border border-[var(--border-strong)] bg-white px-2 py-1 text-sm"
                  aria-label="Send channel"
                >
                  <option value="email">Email</option>
                  <option value="sms">SMS</option>
                </select>
              </label>
              <FormError message={sendState.error} />
            </form>
          ) : null}
        </div>
      ) : open.length > 0 ? (
        <p className="mt-3 text-sm text-[var(--status-neutral)]">
          Convert a pending advisory below to start building the client estimate.
        </p>
      ) : null}
    </section>
  );
}
