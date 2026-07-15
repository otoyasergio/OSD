"use client";

import { useActionState, useMemo, useState } from "react";
import type { InspectionDetail, InspectionResultRow } from "@/lib/services/inspections";
import { InspectionItemRow } from "@/components/inspections/InspectionItemRow";
import { InspectionPhotoSlot } from "@/components/inspections/InspectionPhotoSlot";
import { completeInspectionAction } from "@/app/(app)/work_orders/[work_order_id]/inspection/actions";
import { isInspectionReadOnly } from "@/lib/services/inspectionGate";
import { FormError } from "@/components/forms/Field";
import { SubmitButton } from "@/components/forms/SubmitButton";
import type { PhotoCategory } from "@/lib/database/types";

const SECTION_PHOTO: Record<
  string,
  { category: PhotoCategory; label: string } | undefined
> = {
  "Brakes & Tires — Front": undefined,
  "Brakes & Tires — Rear": undefined,
  "Brakes & Tires": undefined,
  "Frame, Chassis, and Suspension": {
    category: "inspection_forks",
    label: "Forks photo",
  },
};

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString();
}

function sectionPhotoForCategory(
  category: string
): { category: PhotoCategory; label: string } | null {
  if (category.startsWith("Brakes & Tires")) {
    return null;
  }
  return SECTION_PHOTO[category] ?? null;
}

export function InspectionChecklist({
  inspection,
  canEdit,
  canForceComplete,
  canRecommend,
}: {
  inspection: InspectionDetail;
  canEdit: boolean;
  canForceComplete: boolean;
  canRecommend?: boolean;
}) {
  const [completeState, completeAction] = useActionState(
    completeInspectionAction.bind(null, inspection.work_order_id),
    { error: null }
  );
  const [forceConfirm, setForceConfirm] = useState(false);
  const readOnly = isInspectionReadOnly({
    is_foreign_location: inspection.is_foreign_location,
    completed_at: inspection.completed_at,
    work_order_status: inspection.work_order_status,
    canEdit,
  });

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

  const photosByResult = useMemo(() => {
    const map = new Map<string, string | null>();
    for (const photo of inspection.photos) {
      if (photo.inspection_result_id && !map.has(photo.inspection_result_id)) {
        map.set(photo.inspection_result_id, photo.signed_url);
      }
    }
    return map;
  }, [inspection.photos]);

  const sectionPhotoUrl = useMemo(() => {
    const map = new Map<string, string | null>();
    for (const photo of inspection.photos) {
      if (!map.has(photo.category)) {
        map.set(photo.category, photo.signed_url);
      }
    }
    return map;
  }, [inspection.photos]);

  const missingPhotoLabels = inspection.missing_photos.map((p) => p.label);
  const totalCount = inspection.results.length;
  const checkedCount = totalCount - inspection.incomplete_count;
  const statusTotals = useMemo(() => {
    let ok = 0;
    let future = 0;
    let immediate = 0;
    let na = 0;
    for (const r of inspection.results) {
      if (r.status === "ok") ok += 1;
      else if (r.status === "future_attention") future += 1;
      else if (r.status === "immediate_attention") immediate += 1;
      else if (r.status === "not_applicable") na += 1;
    }
    return { ok, future, immediate, na };
  }, [inspection.results]);
  const brakeSkipped = inspection.results.some(
    (r) =>
      r.item_name_snapshot ===
        "Brake Inspection Not Performed This Visit" && r.status === "ok"
  );
  const showTireBrakePhotos =
    !brakeSkipped &&
    (inspection.photos.some(
      (p) =>
        p.category === "inspection_tires" ||
        p.category === "inspection_brakes"
    ) ||
      inspection.results.some(
        (r) =>
          r.status != null &&
          r.category_snapshot.startsWith("Brakes & Tires") &&
          r.item_name_snapshot !==
            "Brake Inspection Not Performed This Visit"
      ));

  const header = inspection.header;

  return (
    <div className="inspection-report">
      <header className="inspection-report-header">
        <div className="inspection-report-brand">
          <h1 className="inspection-report-title">
            Visual Motorcycle Inspection Report
          </h1>
          <p className="inspection-report-wo">{inspection.work_order_number}</p>
        </div>

        <div className="inspection-report-legend" aria-label="Status legend">
          <span className="inspection-legend-item">
            <span className="inspection-status-swatch inspection-status-ok is-selected" />
            Checked and OK
          </span>
          <span className="inspection-legend-item">
            <span className="inspection-status-swatch inspection-status-future is-selected" />
            May need future attention
          </span>
          <span className="inspection-legend-item">
            <span className="inspection-status-swatch inspection-status-immediate is-selected" />
            Requires immediate attention
          </span>
          <span className="inspection-legend-item">
            <span className="inspection-status-swatch inspection-status-na is-selected" />
            Not applicable
          </span>
        </div>

        <dl className="inspection-report-meta">
          <div>
            <dt>Customer</dt>
            <dd>{header.customer_name ?? "—"}</dd>
          </div>
          <div>
            <dt>Yr / Make / Model</dt>
            <dd>{header.motorcycle_label ?? "—"}</dd>
          </div>
          <div>
            <dt>VIN</dt>
            <dd className="font-mono text-sm">{header.vin ?? "—"}</dd>
          </div>
          <div>
            <dt>Mileage</dt>
            <dd>
              {header.mileage != null ? header.mileage.toLocaleString() : "—"}
            </dd>
          </div>
          <div>
            <dt>RO #</dt>
            <dd>{inspection.work_order_number}</dd>
          </div>
          <div>
            <dt>Tech</dt>
            <dd>{header.technician_name ?? "—"}</dd>
          </div>
          <div>
            <dt>Date</dt>
            <dd>{formatDate(header.date_created)}</dd>
          </div>
        </dl>
      </header>

      <div className="inspection-checklist-toolbar">
        <div className="inspection-progress">
          {!inspection.completed_at ? (
            <>
              <div
                className="inspection-progress-track"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={totalCount}
                aria-valuenow={checkedCount}
                aria-label="Inspection progress"
              >
                <span
                  className="inspection-progress-fill"
                  style={{
                    width: `${totalCount === 0 ? 0 : Math.round((checkedCount / totalCount) * 100)}%`,
                  }}
                />
              </div>
              <p className="inspection-progress-text">
                <strong>{checkedCount}</strong> of {totalCount} items checked
              </p>
            </>
          ) : (
            <p className="text-sm font-medium text-emerald-800">
              Inspection completed{" "}
              {new Date(inspection.completed_at).toLocaleString()}
            </p>
          )}
          <div className="inspection-summary-chips" aria-label="Result totals">
            <span className="inspection-summary-chip inspection-summary-chip--ok">
              {statusTotals.ok} OK
            </span>
            <span className="inspection-summary-chip inspection-summary-chip--future">
              {statusTotals.future} future
            </span>
            <span className="inspection-summary-chip inspection-summary-chip--immediate">
              {statusTotals.immediate} immediate
            </span>
            <span className="inspection-summary-chip inspection-summary-chip--na">
              {statusTotals.na} N/A
            </span>
          </div>
          {missingPhotoLabels.length > 0 ? (
            <p className="text-sm font-medium text-amber-900">
              {missingPhotoLabels.length} required photo
              {missingPhotoLabels.length === 1 ? "" : "s"} still needed.
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
                  className="btn btn-secondary min-h-12 border-amber-400 bg-amber-50 text-amber-950 hover:bg-amber-100"
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
                    className="btn btn-secondary min-h-12"
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

      {showTireBrakePhotos &&
      (!readOnly ||
        sectionPhotoUrl.get("inspection_tires") ||
        sectionPhotoUrl.get("inspection_brakes")) ? (
        <section className="inspection-section-photos">
          <h2 className="inspection-section-header">Required section photos</h2>
          <div className="inspection-photo-grid">
            {!readOnly || sectionPhotoUrl.get("inspection_tires") ? (
              <InspectionPhotoSlot
                workOrderId={inspection.work_order_id}
                category="inspection_tires"
                label="Tires"
                required
                existingUrl={sectionPhotoUrl.get("inspection_tires")}
                readOnly={readOnly}
              />
            ) : null}
            {!readOnly || sectionPhotoUrl.get("inspection_brakes") ? (
              <InspectionPhotoSlot
                workOrderId={inspection.work_order_id}
                category="inspection_brakes"
                label="Brakes"
                required
                existingUrl={sectionPhotoUrl.get("inspection_brakes")}
                readOnly={readOnly}
              />
            ) : null}
          </div>
        </section>
      ) : null}

      <div className="inspection-report-columns">
        {Object.entries(grouped).map(([category, results]) => {
          const sectionPhoto = sectionPhotoForCategory(category);
          const forksNeeded =
            sectionPhoto?.category === "inspection_forks" &&
            (inspection.missing_photos.some(
              (p) => p.category === "inspection_forks"
            ) ||
              sectionPhotoUrl.has("inspection_forks") ||
              results.some(
                (r) =>
                  r.status != null && /front forks/i.test(r.item_name_snapshot)
              ));

          const sectionChecked = results.filter((r) => r.status != null).length;
          const sectionImmediate = results.filter(
            (r) => r.status === "immediate_attention"
          ).length;
          const sectionFuture = results.filter(
            (r) => r.status === "future_attention"
          ).length;
          const sectionDone = sectionChecked === results.length;
          const countClass = sectionImmediate
            ? "inspection-section-count--immediate"
            : sectionFuture
              ? "inspection-section-count--future"
              : sectionDone
                ? "inspection-section-count--done"
                : "";

          return (
            <section key={category} className="inspection-section">
              <h2 className="inspection-section-header">
                <span className="inspection-section-header-title">
                  {category}
                </span>
                <span
                  className={`inspection-section-count ${countClass}`}
                  aria-label={`${sectionChecked} of ${results.length} items checked${
                    sectionImmediate
                      ? `, ${sectionImmediate} requiring immediate attention`
                      : ""
                  }`}
                >
                  {sectionDone ? "✓ " : ""}
                  {sectionChecked}/{results.length}
                </span>
              </h2>
              {forksNeeded &&
              sectionPhoto &&
              (!readOnly || sectionPhotoUrl.get(sectionPhoto.category)) ? (
                <div className="mb-3">
                  <InspectionPhotoSlot
                    workOrderId={inspection.work_order_id}
                    category={sectionPhoto.category}
                    label={sectionPhoto.label}
                    required
                    existingUrl={sectionPhotoUrl.get(sectionPhoto.category)}
                    readOnly={readOnly}
                  />
                </div>
              ) : null}
              <div className="inspection-section-items">
                {results.map((result) => (
                  <InspectionItemRow
                    key={result.inspection_result_id}
                    workOrderId={inspection.work_order_id}
                    result={result}
                    readOnly={readOnly}
                    compact={
                      !result.requires_measurement_snapshot &&
                      !category.startsWith("Comments")
                    }
                    photoUrl={photosByResult.get(result.inspection_result_id)}
                    photoRequired={inspection.missing_photos.some(
                      (p) =>
                        p.inspection_result_id === result.inspection_result_id
                    )}
                    onRecommend={
                      canRecommend
                        ? (r) => {
                            window.location.href = `/work_orders/${inspection.work_order_id}?tab=recommendations&from_result=${r.inspection_result_id}`;
                          }
                        : undefined
                    }
                  />
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
