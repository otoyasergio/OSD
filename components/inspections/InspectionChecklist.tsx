"use client";

import { useActionState, useMemo, useState } from "react";
import type { AuctionPriceGuideView } from "@/lib/auctions/types";
import type { InspectionDetail, InspectionResultRow } from "@/lib/services/inspections";
import { InspectionAuctionPrice } from "@/components/auctions/InspectionAuctionPrice";
import { inspectionAuctionAnchorCategory } from "@/lib/inspections/inspectionAuctionPlacement";
import { InspectionItemRow } from "@/components/inspections/InspectionItemRow";
import { InspectionPhotoSlot } from "@/components/inspections/InspectionPhotoSlot";
import { PhotoLightbox } from "@/components/photos/PhotoLightbox";
import { completeInspectionAction } from "@/app/(app)/work_orders/[work_order_id]/inspection/actions";
import {
  countIncompleteInspectionResults,
  getMissingInspectionPhotos,
  getRequiredInspectionPhotos,
  inspectionPhotoMatchesRequirement,
  inspectionResultGaps,
  isInspectionReadOnly,
  type InspectionGateResult,
  type InspectionPhotoRequirement,
} from "@/lib/services/inspectionGate";
import { FormError } from "@/components/forms/Field";
import { SubmitButton } from "@/components/forms/SubmitButton";
import { SignOffPad } from "@/components/inspections/SignOffPad";
import type { InspectionResultStatus } from "@/lib/database/types";
import { formatDate, formatDateTime } from "@/lib/datetime/format";
import { formatMileage } from "@/lib/mileage/format";
import { toLightboxPhotos } from "@/lib/photos/lightbox";
import {
  inspectionPhotoUrls,
  inspectionPhotosForCategory,
} from "@/lib/inspections/groupInspectionPhotos";
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

function gateResults(
  results: InspectionDetail["results"],
  localStatuses: Record<string, InspectionResultStatus | null>,
  drafts: Record<string, { notes: string; measurement: string }>
): InspectionGateResult[] {
  return results.map((result) => {
    const draft = drafts[result.inspection_result_id];
    return {
      inspection_result_id: result.inspection_result_id,
      status: localStatuses[result.inspection_result_id] ?? result.status,
      category_snapshot: result.category_snapshot,
      item_name_snapshot: result.item_name_snapshot,
      notes: draft?.notes ?? result.notes,
      measurement: draft?.measurement ?? result.measurement,
      requires_measurement: result.requires_measurement_snapshot,
    };
  });
}

function photoUrlsFor(
  photos: InspectionDetail["photos"],
  requirement: InspectionPhotoRequirement
): string[] {
  return inspectionPhotoUrls(
    photos.filter((photo) => inspectionPhotoMatchesRequirement(photo, requirement))
  );
}

export function InspectionChecklist({
  inspection,
  canEdit,
  canForceComplete,
  canRecommend,
  completeReturnTo,
  auctionGuide = null,
}: {
  inspection: InspectionDetail;
  canEdit: boolean;
  canForceComplete: boolean;
  canRecommend?: boolean;
  completeReturnTo?: string | null;
  auctionGuide?: AuctionPriceGuideView | null;
}) {
  const [completeState, completeAction] = useActionState(
    completeInspectionAction.bind(null, inspection.work_order_id),
    { error: null }
  );
  const [forceConfirm, setForceConfirm] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [busyIds, setBusyIds] = useState<Record<string, boolean>>({});
  const [signatureReady, setSignatureReady] = useState(false);
  const [drafts, setDrafts] = useState<
    Record<string, { notes: string; measurement: string }>
  >({});
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
  const gated = useMemo(
    () => gateResults(inspection.results, localStatuses, drafts),
    [drafts, inspection.results, localStatuses]
  );
  const gaps = useMemo(() => inspectionResultGaps(gated), [gated]);
  const localIncompleteCount = useMemo(
    () => countIncompleteInspectionResults(gated),
    [gated]
  );
  const requiredPhotos = useMemo(() => getRequiredInspectionPhotos(gated), [gated]);
  const missingPhotos = useMemo(
    () => getMissingInspectionPhotos(gated, inspection.photos),
    [gated, inspection.photos]
  );
  const gridPhotos = requiredPhotos.filter((photo) => photo.surface === "grid");

  const lightboxPhotos = useMemo(
    () => toLightboxPhotos(inspection.photos),
    [inspection.photos]
  );

  function openPhotoBySrc(src: string | null | undefined) {
    if (!src) return;
    const match = inspection.photos.find(
      (photo) => photo.thumb_url === src || photo.signed_url === src
    );
    const index = match
      ? lightboxPhotos.findIndex((photo) => photo.id === match.photo_id)
      : lightboxPhotos.findIndex(
          (photo) => photo.src === src || photo.previewSrc === src
        );
    if (index >= 0) setLightboxIndex(index);
  }

  const legacyTireUrls = useMemo(
    () =>
      inspectionPhotoUrls(
        inspectionPhotosForCategory(inspection.photos, "inspection_tires")
      ),
    [inspection.photos]
  );
  const legacyBrakeUrls = useMemo(
    () =>
      inspectionPhotoUrls(
        inspectionPhotosForCategory(inspection.photos, "inspection_brakes")
      ),
    [inspection.photos]
  );

  const totalCount = inspection.results.length;
  const checkedCount = totalCount - localIncompleteCount;
  const measurementGaps = gaps.filter((gap) => gap.kind === "measurement");
  const reasonGaps = gaps.filter((gap) => gap.kind === "reason");
  const uncheckedGaps = gaps.filter((gap) => gap.kind === "unchecked");
  const finishBlocked =
    saving || localIncompleteCount > 0 || missingPhotos.length > 0 || !signatureReady;
  const statusTotals = useMemo(() => {
    let ok = 0;
    let future = 0;
    let immediate = 0;
    let na = 0;
    for (const result of gated) {
      if (result.status === "ok") ok += 1;
      else if (result.status === "future_attention") future += 1;
      else if (result.status === "immediate_attention") immediate += 1;
      else if (result.status === "not_applicable") na += 1;
    }
    return { ok, future, immediate, na };
  }, [gated]);
  const gridComplete =
    gridPhotos.length > 0 &&
    gridPhotos.every(
      (photo) => !missingPhotos.some((missing) => missing.label === photo.label)
    );
  const visibleGridPhotos = gridPhotos.filter((photo) => {
    if (!readOnly) return true;
    return photoUrlsFor(inspection.photos, photo).length > 0;
  });

  const header = inspection.header;
  const auctionAnchor = inspectionAuctionAnchorCategory(Object.keys(grouped));

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
          {missingPhotos.length > 0 ? (
            <p className="text-sm font-medium text-amber-900">
              {missingPhotos.length} required photo
              {missingPhotos.length === 1 ? "" : "s"} still needed.
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
            {localIncompleteCount > 0 ? (
              <p className="text-sm text-amber-900">
                {localIncompleteCount} line{localIncompleteCount === 1 ? "" : "s"} still
                open. Measurements and real reasons count.
              </p>
            ) : null}
            <FormError message={completeState.error} />
          </div>
        ) : null}
      </div>

      {visibleGridPhotos.length > 0 ||
      legacyTireUrls.length > 0 ||
      legacyBrakeUrls.length > 0 ? (
        <section
          className={`inspection-evidence ${gridComplete ? "is-complete" : ""}`}
          aria-label="Evidence photos"
        >
          <h2 className="inspection-section-header">Evidence photos</h2>
          {!readOnly ? (
            <p className="inspection-evidence-lede">
              Front and rear each need their own photo. One shot of the bike does not
              cover tires, brakes, and forks.
            </p>
          ) : null}
          {visibleGridPhotos.length > 0 ? (
            <div className="inspection-photo-grid">
              {visibleGridPhotos.map((photo) => {
                const urls = photoUrlsFor(inspection.photos, photo);
                return (
                  <InspectionPhotoSlot
                    key={photo.label}
                    id={
                      photo.inspection_result_id
                        ? `inspection-evidence-${photo.inspection_result_id}`
                        : undefined
                    }
                    workOrderId={inspection.work_order_id}
                    category="inspection_item"
                    inspectionResultId={photo.inspection_result_id}
                    label={photo.label}
                    detail={photo.detail}
                    required
                    existingUrls={urls}
                    readOnly={readOnly}
                    onExpand={openPhotoBySrc}
                  />
                );
              })}
            </div>
          ) : null}
          {legacyTireUrls.length > 0 || legacyBrakeUrls.length > 0 ? (
            <div className="inspection-photo-grid mt-3">
              {legacyTireUrls.length > 0 ? (
                <InspectionPhotoSlot
                  workOrderId={inspection.work_order_id}
                  category="inspection_tires"
                  label="Earlier combined tire photo"
                  detail="Kept on the report. Front and rear photos are still required."
                  existingUrls={legacyTireUrls}
                  readOnly
                  onExpand={openPhotoBySrc}
                />
              ) : null}
              {legacyBrakeUrls.length > 0 ? (
                <InspectionPhotoSlot
                  workOrderId={inspection.work_order_id}
                  category="inspection_brakes"
                  label="Earlier combined brake photo"
                  detail="Kept on the report. Front and rear photos are still required."
                  existingUrls={legacyBrakeUrls}
                  readOnly
                  onExpand={openPhotoBySrc}
                />
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}

      <div className="inspection-report-columns">
        {Object.entries(grouped).map(([category, results]) => {
          const showAuctionHere = category === auctionAnchor;
          const sectionGated = gated.filter(
            (result) => result.category_snapshot === category
          );
          const sectionChecked =
            results.length -
            countIncompleteInspectionResults(gated, { within: sectionGated });
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

          const section = (
            <section className="inspection-section">
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
              <div className="inspection-section-items">
                {results.map((result) => {
                  const inlinePhoto = requiredPhotos.find(
                    (photo) =>
                      photo.surface === "inline" &&
                      photo.inspection_result_id === result.inspection_result_id
                  );
                  const gridAnchor = requiredPhotos.find(
                    (photo) =>
                      photo.surface === "grid" &&
                      photo.inspection_result_id === result.inspection_result_id
                  );
                  const inlineUrls = inlinePhoto
                    ? photoUrlsFor(inspection.photos, inlinePhoto)
                    : [];
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
                      photoUrls={inlineUrls}
                      inlinePhoto={
                        inlinePhoto
                          ? {
                              label: inlinePhoto.label,
                              detail: inlinePhoto.detail,
                              required: true,
                            }
                          : null
                      }
                      evidenceCallout={
                        gridAnchor
                          ? {
                              label: gridAnchor.label,
                              href: `#inspection-evidence-${gridAnchor.inspection_result_id}`,
                              missing: missingPhotos.some(
                                (photo) =>
                                  photo.inspection_result_id ===
                                  gridAnchor.inspection_result_id
                              ),
                            }
                          : null
                      }
                      incomplete={gaps.some(
                        (gap) => gap.key === result.inspection_result_id
                      )}
                      onExpandPhoto={inlineUrls.length > 0 ? openPhotoBySrc : undefined}
                      onBusyChange={(resultId, busy) => {
                        setBusyIds((current) => ({ ...current, [resultId]: busy }));
                      }}
                      onLocalStatusChange={(resultId, status) => {
                        setLocalStatuses((current) => ({
                          ...current,
                          [resultId]: status,
                        }));
                      }}
                      onLocalDraftChange={(resultId, draft) => {
                        setDrafts((current) => ({ ...current, [resultId]: draft }));
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

          return (
            <div key={category} className="inspection-column-stack">
              {section}
              {showAuctionHere ? <InspectionAuctionPrice guide={auctionGuide} /> : null}
            </div>
          );
        })}
        {auctionAnchor == null ? <InspectionAuctionPrice guide={auctionGuide} /> : null}
      </div>

      {!readOnly ? (
        <form
          action={completeAction}
          className="inspection-finish"
          onSubmit={(event) => {
            if (!signatureReady || missingPhotos.length > 0 || saving) {
              event.preventDefault();
            }
            if (!forceConfirm && localIncompleteCount > 0) {
              event.preventDefault();
            }
          }}
        >
          {completeReturnTo ? (
            <input type="hidden" name="return_to" value={completeReturnTo} />
          ) : null}
          {forceConfirm ? <input type="hidden" name="force" value="true" /> : null}
          <section className="inspection-signoff" id="inspection-signoff">
            <h2 className="inspection-signoff-title">Technician signature</h2>
            <p className="inspection-signoff-statement">
              I inspected this motorcycle. The checklist, measurements, and photos above
              are what I found, and I am signing this report.
            </p>
            <SignOffPad label="Technician signature" onReadyChange={setSignatureReady} />
            {uncheckedGaps.length > 0 ||
            measurementGaps.length > 0 ||
            reasonGaps.length > 0 ||
            missingPhotos.length > 0 ? (
              <div className="inspection-gap-panel">
                <p className="inspection-gap-title">Still required before sign-off</p>
                {uncheckedGaps.length > 0 ? (
                  <p>
                    {uncheckedGaps.length} line{uncheckedGaps.length === 1 ? "" : "s"} not
                    checked.
                  </p>
                ) : null}
                {measurementGaps.length > 0 ? (
                  <>
                    <p>Enter the measurement</p>
                    <ul className="inspection-gap-list">
                      {measurementGaps.map((gap) => (
                        <li key={`${gap.key}-measurement`}>{gap.item_name}</li>
                      ))}
                    </ul>
                  </>
                ) : null}
                {reasonGaps.length > 0 ? (
                  <>
                    <p>Write a real reason — “n/a” or “ok” does not count</p>
                    <ul className="inspection-gap-list">
                      {reasonGaps.map((gap) => (
                        <li key={`${gap.key}-reason`}>
                          {gap.item_name}
                          <span className="inspection-gap-detail"> — {gap.detail}</span>
                        </li>
                      ))}
                    </ul>
                  </>
                ) : null}
                {missingPhotos.length > 0 ? (
                  <>
                    <p>Photos</p>
                    <ul className="inspection-gap-list">
                      {missingPhotos.map((photo) => (
                        <li key={photo.label}>
                          {photo.inspection_result_id ? (
                            <a
                              href={`#inspection-evidence-${photo.inspection_result_id}`}
                            >
                              {photo.label}
                            </a>
                          ) : (
                            photo.label
                          )}
                        </li>
                      ))}
                    </ul>
                  </>
                ) : null}
              </div>
            ) : null}
          </section>
          <div className="inspection-complete-dock">
            <p className="inspection-complete-dock-count">
              <strong>{checkedCount}</strong> / {totalCount}
              {finishBlocked ? (
                <span className="inspection-complete-dock-left">
                  {" "}
                  ·{" "}
                  {[
                    uncheckedGaps.length ? `${uncheckedGaps.length} unchecked` : null,
                    measurementGaps.length
                      ? `${measurementGaps.length} measurements`
                      : null,
                    reasonGaps.length ? `${reasonGaps.length} reasons` : null,
                    missingPhotos.length ? `${missingPhotos.length} photos` : null,
                    !signatureReady ? "signature" : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              ) : (
                <span className="inspection-complete-dock-left"> · ready to sign</span>
              )}
            </p>
            <SubmitButton
              label="Sign and complete inspection"
              pendingLabel="Completing…"
              disabled={finishBlocked || forceConfirm}
              className="inspection-complete-dock-go"
            />
            {localIncompleteCount > 0 && canForceComplete ? (
              !forceConfirm ? (
                <button
                  type="button"
                  onClick={() => setForceConfirm(true)}
                  disabled={saving}
                  className="btn btn-secondary"
                >
                  Force complete ({localIncompleteCount} unfinished)…
                </button>
              ) : (
                <div className="inspection-complete-dock-form flex flex-col gap-2">
                  <p className="text-sm text-amber-950">
                    Force complete leaves unfinished lines on the report. Photos and your
                    signature are still required.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <SubmitButton
                      label="Confirm force complete"
                      pendingLabel="Completing…"
                      disabled={saving || missingPhotos.length > 0 || !signatureReady}
                    />
                    <button
                      type="button"
                      onClick={() => setForceConfirm(false)}
                      className="btn btn-secondary"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )
            ) : null}
            <FormError message={completeState.error} />
          </div>
        </form>
      ) : inspection.completed_at ? (
        <section className="inspection-signoff" id="inspection-signoff">
          <h2 className="inspection-signoff-title">Technician signature</h2>
          <p className="inspection-signoff-statement">
            I inspected this motorcycle. The checklist, measurements, and photos above are
            what I found.
          </p>
          {inspection.signature_signed_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={inspection.signature_signed_url}
              alt={`Signature of ${inspection.completed_by_name ?? "the technician"}`}
              className="inspection-signoff-image"
            />
          ) : (
            <p className="inspection-signoff-missing">
              No drawn signature on file. This report was completed before a signature was
              required.
            </p>
          )}
          <p className="inspection-signoff-line">
            {inspection.completed_by_name ?? "Technician"}
            {inspection.completed_at
              ? ` · ${formatDateTime(inspection.completed_at)}`
              : ""}
          </p>
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
