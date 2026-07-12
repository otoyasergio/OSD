import Link from "next/link";
import type { OutstandingRecommendation } from "@/lib/services/recommendations";
import {
  RECOMMENDATION_SEVERITY_LABELS,
  RECOMMENDATION_STATUS_LABELS,
} from "@/lib/status/labels";

const SEVERITY_STYLES = {
  future_attention: "bg-amber-100 text-amber-900",
  immediate_attention: "bg-orange-100 text-orange-900",
  safety_critical: "bg-red-100 text-red-900",
} as const;

const STATUS_STYLES = {
  pending: "bg-zinc-100 text-zinc-800",
  deferred: "bg-sky-100 text-sky-900",
  declined: "bg-rose-100 text-rose-900",
  approved: "bg-emerald-100 text-emerald-900",
  converted_to_job: "bg-emerald-100 text-emerald-900",
} as const;

export function OutstandingRecommendations({
  recommendations,
  title,
  hideWhenEmpty = false,
}: {
  recommendations: OutstandingRecommendation[];
  title: string;
  hideWhenEmpty?: boolean;
}) {
  if (recommendations.length === 0) {
    if (hideWhenEmpty) return null;
    return (
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-zinc-900">{title}</h2>
        <p className="rounded border border-dashed border-zinc-300 bg-white px-4 py-6 text-sm text-zinc-600">
          No outstanding recommendations from previous visits.
        </p>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold text-zinc-900">{title}</h2>
      <ul className="flex flex-col gap-2">
        {recommendations.map((recommendation) => {
          const isSafety = recommendation.severity === "safety_critical";
          return (
            <li
              key={recommendation.recommendation_id}
              className={`rounded border px-4 py-3 ${
                isSafety
                  ? "border-red-300 bg-red-50"
                  : "border-zinc-200 bg-white"
              }`}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <p className="font-medium text-zinc-900">
                  {recommendation.description}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  <span
                    className={`rounded px-2 py-0.5 text-xs font-semibold ${
                      SEVERITY_STYLES[recommendation.severity]
                    }`}
                  >
                    {RECOMMENDATION_SEVERITY_LABELS[recommendation.severity]}
                  </span>
                  <span
                    className={`rounded px-2 py-0.5 text-xs font-semibold ${
                      STATUS_STYLES[recommendation.status]
                    }`}
                  >
                    {RECOMMENDATION_STATUS_LABELS[recommendation.status]}
                  </span>
                </div>
              </div>
              <p className="mt-1.5 text-sm text-zinc-600">
                Source:{" "}
                <Link
                  href={`/work_orders/${recommendation.work_order.work_order_id}`}
                  className="font-medium underline-offset-2 hover:underline"
                >
                  {recommendation.work_order.work_order_number}
                </Link>
              </p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
