"use client";

import { useActionState, useMemo, useState } from "react";
import type { InspectionDetail, InspectionResultRow } from "@/lib/services/inspections";
import { InspectionItemRow } from "@/components/inspections/InspectionItemRow";
import { completeInspectionAction } from "@/app/(app)/work_orders/[work_order_id]/inspection/actions";
import { FormError } from "@/components/forms/Field";
import { SubmitButton } from "@/components/forms/SubmitButton";

export function InspectionChecklist({
  inspection,
  canEdit,
  canForceComplete,
  recommendHref,
}: {
  inspection: InspectionDetail;
  canEdit: boolean;
  canForceComplete: boolean;
  recommendHref?: (result: InspectionResultRow) => string;
}) {
  const [completeState, completeAction] = useActionState(
    completeInspectionAction.bind(null, inspection.work_order_id),
    { error: null }
  );
  const [forceConfirm, setForceConfirm] = useState(false);
  const readOnly =
    inspection.is_foreign_location ||
    Boolean(inspection.completed_at) ||
    !canEdit;

  const grouped = useMemo(() => {
    return inspection.results.reduce<Record<string, InspectionResultRow[]>>(
      (acc, result) => {
        const key = result.category_snapshot;
        if (!acc[key]) acc[key] = [];
        acc[key].push(result);
        return acc;
      },
      {}
    );
  }, [inspection.results]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm text-zinc-600">
            {inspection.incomplete_count === 0
              ? "All items have a status."
              : `${inspection.incomplete_count} incomplete item${
                  inspection.incomplete_count === 1 ? "" : "s"
                }`}
          </p>
          {inspection.completed_at ? (
            <p className="mt-1 text-sm font-medium text-emerald-800">
              Inspection completed{" "}
              {new Date(inspection.completed_at).toLocaleString()}
            </p>
          ) : null}
        </div>

        {!readOnly ? (
          <div className="flex flex-col items-end gap-2">
            {inspection.incomplete_count > 0 && canForceComplete ? (
              !forceConfirm ? (
                <button
                  type="button"
                  onClick={() => setForceConfirm(true)}
                  className="min-h-11 rounded border border-amber-400 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-950 hover:bg-amber-100"
                >
                  Force complete ({inspection.incomplete_count} incomplete)…
                </button>
              ) : (
                <form action={completeAction} className="flex flex-wrap gap-2">
                  <input type="hidden" name="force" value="true" />
                  <SubmitButton
                    label="Confirm force complete"
                    pendingLabel="Completing…"
                  />
                  <button
                    type="button"
                    onClick={() => setForceConfirm(false)}
                    className="min-h-11 rounded border border-zinc-300 bg-white px-3 py-2 text-sm font-semibold text-zinc-800"
                  >
                    Cancel
                  </button>
                </form>
              )
            ) : (
              <form action={completeAction}>
                <SubmitButton
                  label="Complete inspection"
                  pendingLabel="Completing…"
                />
              </form>
            )}
            <FormError message={completeState.error} />
          </div>
        ) : null}
      </div>

      {Object.entries(grouped).map(([category, results]) => (
        <section key={category} className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
            {category}
          </h2>
          {results.map((result) => (
            <InspectionItemRow
              key={result.inspection_result_id}
              workOrderId={inspection.work_order_id}
              result={result}
              readOnly={readOnly}
              onRecommend={
                recommendHref
                  ? (r) => {
                      window.location.href = recommendHref(r);
                    }
                  : undefined
              }
            />
          ))}
        </section>
      ))}
    </div>
  );
}
