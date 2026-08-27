"use client";

import { useActionState, useMemo, useState } from "react";
import type { InspectionDetail, InspectionResultRow } from "@/lib/services/inspections";
import { InspectionItemRow } from "@/components/inspections/InspectionItemRow";
import { InspectionPhotoSlot } from "@/components/inspections/InspectionPhotoSlot";
import { PhotoLightbox } from "@/components/photos/PhotoLightbox";
import { completeInspectionAction } from "@/app/(app)/work_orders/[work_order_id]/inspection/actions";
import {
  countIncompleteInspectionResults,
  isInspectionReadOnly,
} from "@/lib/services/inspectionGate";
import { FormError } from "@/components/forms/Field";
import { SubmitButton } from "@/components/forms/SubmitButton";
import { SignOffPad } from "@/components/inspections/SignOffPad";
import type { InspectionResultStatus, PhotoCategory } from "@/lib/database/types";
import { formatDate, formatDateTime } from "@/lib/datetime/format";
import { formatMileage } from "@/lib/mileage/format";
import { toLightboxPhotos } from "@/lib/photos/lightbox";
import {
  AlertTriangle,
  Bike,
  Check,
  ClipboardList,
  Clock,
  Gauge,
  Lightbulb,
  MessageSquare,
  Minus,
  type LucideIcon,
} from "lucide-react";

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

function formatInspectionDate(value: string | null) {
  if (!value) return "—";
  return formatDate(value);
}

function sectionIcon(category: string): LucideIcon {
  if (category.startsWith("Brakes") || /tire/i.test(category)) return Bike;
  if (/fork|frame|chassis|suspension/i.test(category)) return Gauge;
  if (/light/i.test(category)) return Lightbulb;
  if (/control/i.test(category)) return Gauge;
  if (/comment/i.test(category)) return MessageSquare;
  return ClipboardList;
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
  completeReturnTo,
}: {
  inspection: InspectionDetail;
  canEdit: boolean;
  canForceComplete: boolean;
  canRecommend?: boolean;
  completeReturnTo?: string | null;
}) {
  const [completeState, completeAction] = useActionState(
    completeInspectionAction.bind(null, inspection.work_order_id),
    { error: null }
  );
  const [forceConfirm, setForceConfirm] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [busyIds, setBusyIds] = useState<Record<string, boolean>>({});
  const [localStatuses, setLocalStatuses] = useState<
    Record<string, InspectionResultStatus | null>
  >(() =>
    Object.fromEntries(inspection.results.map((r) => [r.inspection_result_id, r.status]))
  );
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

  const saving = Object.values(busyIds).some(Boolean);
  const localIncompleteCount = useMemo(
    () =>
      countIncompleteInspectionResults(
        inspection.results.map((r) => ({
          status: localStatuses[r.inspection_result_id] ?? r.status,
          category_snapshot: r.category_snapshot,
          item_name_snapshot: r.item_name_snapshot,
        }))
      ),
    [inspection.results, localStatuses]
  );

  const lightboxPhotos = useMemo(
    () => toLightboxPhotos(inspection.photos),
    [inspection.photos]
  );

  function openPhotoBySrc(src: string | null | undefined) {
    if (!src) return;
    const index = lightboxPhotos.findIndex((photo) => photo.src === src);
    if (index >= 0) setLightboxIndex(index);
  }

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
  const checkedCount = totalCount - localIncompleteCount;
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
      r.item_name_snapshot === "Brake Inspection Not Performed This Visit" &&
      r.status === "ok"
  );
  const showTireBrakePhotos =
    !brakeSkipped &&
    (inspection.photos.some(
      (p) => p.category === "inspection_tires" || p.category === "inspection_brakes"
    ) ||
      inspection.results.some(
        (r) =>
          r.status != null &&
          r.category_snapshot.startsWith("Brakes & Tires") &&
          r.item_name_snapshot !== "Brake Inspection Not Performed This Visit"
      ));

  const header = inspection.header;

  return (
    <div className="inspection-report">
      <header className="inspection-report-header">
        <div className="inspection-report-brand">
          <h1 className="inspection-report-title">Visual Motorcycle Inspection Report</h1>
          <p className="inspection-report-wo">{inspection.work_order_number}</p>
        </div>

        <div className="inspection-report-legend" aria-label="Status legend">
          <span className="inspection-legend-item">
            <span className="inspection-status-swatch inspection-status-ok is-selected">
              <Check size={16} aria-hidden />
            </span>
            OK
          </span>
          <span className="inspection-legend-item">
            <span className="inspection-status-swatch inspection-status-future is-selected">
              <Clock size={16} aria-hidden />
            </span>
            Future
          </span>
          <span className="inspection-legend-item">
            <span className="inspection-status-swatch inspection-status-immediate is-selected">
              <AlertTriangle size={16} aria-hidden />
            </span>
            Now
          </span>
          <span className="inspection-legend-item">
            <span className="inspection-status-swatch inspection-status-na is-selected">
              <Minus size={16} aria-hidden />
            </span>
            N/A
          </span>
        </div>

        <dl className="inspection-report-meta">
          {header.customer_name ? (
            <div>
              <dt>Customer</dt>
              <dd>{header.customer_name}</dd>
            </div>
          ) : null}
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
            <dd>{formatMileage(header.mileage, header.mileage_unit)}</dd>
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
            <dd>{formatInspectionDate(header.date_created)}</dd>
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
              Inspection completed {formatDateTime(inspection.completed_at)}
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
            {saving ? (
              <p className="text-sm text-[var(--status-neutral)]">
                Saving checklist changes…
              </p>
            ) : null}
            {localIncompleteCount > 0 && !canForceComplete ? (
              <p className="text-sm text-amber-900">
                Check all fields ({localIncompleteCount} still open)
                {saving ? " — wait for saves to finish" : ""}.
              </p>
            ) : null}
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
                onExpand={
                  sectionPhotoUrl.get("inspection_tires")
                    ? () => openPhotoBySrc(sectionPhotoUrl.get("inspection_tires"))
                    : undefined
                }
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
                onExpand={
                  sectionPhotoUrl.get("inspection_brakes")
                    ? () => openPhotoBySrc(sectionPhotoUrl.get("inspection_brakes"))
                    : undefined
                }
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
            (inspection.missing_photos.some((p) => p.category === "inspection_forks") ||
              sectionPhotoUrl.has("inspection_forks") ||
              results.some(
                (r) => r.status != null && /front forks/i.test(r.item_name_snapshot)
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
          const SectionIcon = sectionIcon(category);

          return (
            <section key={category} className="inspection-section">
              <h2 className="inspection-section-header">
                <span className="inspection-section-header-title">
                  <SectionIcon
                    size={18}
                    aria-hidden
                    className="inspection-section-icon"
                  />
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
                    onExpand={
                      sectionPhotoUrl.get(sectionPhoto.category)
                        ? () => openPhotoBySrc(sectionPhotoUrl.get(sectionPhoto.category))
                        : undefined
                    }
                  />
                </div>
              ) : null}
              <div className="inspection-section-items">
                {results.map((result) => {
                  const itemPhotoUrl = photosByResult.get(result.inspection_result_id);
                  return (
                    <InspectionItemRow
                      key={result.inspection_result_id}
                      workOrderId={inspection.work_order_id}
                      result={result}
                      readOnly={readOnly}
                      compact={
                        !result.requires_measurement_snapshot &&
                        !category.startsWith("Comments")
                      }
                      photoUrl={itemPhotoUrl}
                      photoRequired={inspection.missing_photos.some(
                        (p) => p.inspection_result_id === result.inspection_result_id
                      )}
                      onExpandPhoto={
                        itemPhotoUrl ? () => openPhotoBySrc(itemPhotoUrl) : undefined
                      }
                      onBusyChange={(resultId, busy) => {
                        setBusyIds((current) => ({ ...current, [resultId]: busy }));
                      }}
                      onLocalStatusChange={(resultId, status) => {
                        setLocalStatuses((current) => ({
                          ...current,
                          [resultId]: status,
                        }));
                      }}
                      onRecommend={
                        canRecommend
                          ? (r) => {
                              window.location.href = `/work_orders/${inspection.work_order_id}?tab=recommendations&from_result=${r.inspection_result_id}`;
                            }
                          : undefined
                      }
                    />
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>

      {!readOnly ? (
        <div className="inspection-complete-dock">
          <p className="inspection-complete-dock-count">
            <strong>{checkedCount}</strong> / {totalCount}
            {localIncompleteCount > 0 ? (
              <span className="inspection-complete-dock-left">
                {" "}
                · {localIncompleteCount} left
              </span>
            ) : null}
          </p>
          {localIncompleteCount > 0 && canForceComplete ? (
            !forceConfirm ? (
              <button
                type="button"
                onClick={() => setForceConfirm(true)}
                disabled={saving}
                className="btn btn-secondary inspection-complete-dock-go"
              >
                Force complete ({localIncompleteCount} incomplete)…
              </button>
            ) : (
              <form
                action={completeAction}
                className="inspection-complete-dock-form flex flex-col gap-3"
              >
                <input type="hidden" name="force" value="true" />
                {completeReturnTo ? (
                  <input type="hidden" name="return_to" value={completeReturnTo} />
                ) : null}
                <SignOffPad label="Force-complete signature (override)" />
                <div className="flex flex-wrap gap-2">
                  <SubmitButton
                    label="Confirm force complete"
                    pendingLabel="Completing…"
                    disabled={saving}
                    className="inspection-complete-dock-go"
                  />
                  <button
                    type="button"
                    onClick={() => setForceConfirm(false)}
                    className="btn btn-secondary"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )
          ) : (
            <form
              action={completeAction}
              className="inspection-complete-dock-form flex flex-col gap-3"
            >
              {completeReturnTo ? (
                <input type="hidden" name="return_to" value={completeReturnTo} />
              ) : null}
              <SignOffPad label="Tech sign-off" />
              <SubmitButton
                label="Complete arrival inspection"
                pendingLabel="Completing…"
                disabled={saving || localIncompleteCount > 0}
                className="inspection-complete-dock-go"
              />
            </form>
          )}
          <FormError message={completeState.error} />
        </div>
      ) : inspection.completed_at ? (
        <section className="mt-6 rounded border border-[var(--border)] bg-white p-4">
          <h2 className="text-base font-semibold text-foreground">
            Arrival inspection sign-off
          </h2>
          <p className="mt-1 text-sm text-[var(--status-neutral)]">
            Completed
            {inspection.completed_by_name ? ` by ${inspection.completed_by_name}` : ""}
            {inspection.completed_at
              ? ` · ${formatDateTime(inspection.completed_at)}`
              : ""}
          </p>
          {inspection.signature_signed_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={inspection.signature_signed_url}
              alt="Arrival inspection signature"
              className="mt-3 max-h-32 rounded border border-[var(--border)] bg-white"
            />
          ) : (
            <p className="mt-2 text-sm text-[var(--status-neutral)]">
              No drawn signature on file (completed before sign-off was required).
            </p>
          )}
        </section>
      ) : null}

      {lightboxIndex !== null && lightboxPhotos.length > 0 ? (
        <PhotoLightbox
          photos={lightboxPhotos}
          initialIndex={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
        />
      ) : null}
    </div>
  );
}
