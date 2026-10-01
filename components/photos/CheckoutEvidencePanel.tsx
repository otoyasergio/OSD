"use client";

import { useActionState, useMemo, useState } from "react";
import { InspectionPhotoSlot } from "@/components/inspections/InspectionPhotoSlot";
import { PhotoLightbox } from "@/components/photos/PhotoLightbox";
import { FormError, TextAreaField } from "@/components/forms/Field";
import { SubmitButton } from "@/components/forms/SubmitButton";
import type { QualityFormState } from "@/app/(app)/work_orders/quality-actions";
import type { PhotoCategory } from "@/lib/database/types";
import {
  CHECKOUT_EVIDENCE_OVERRIDE_REASON_MAX_LENGTH,
  CHECKOUT_PHOTO_CATEGORIES,
  checkoutCoverageFromPhotos,
} from "@/lib/status/checkoutEvidence";
import { PHOTO_CATEGORY_LABELS } from "@/lib/status/labels";
import { toLightboxPhotos } from "@/lib/photos/lightbox";
import { photoFullUrl, photoPreviewUrl } from "@/lib/photos/urls";

type CheckoutPhoto = {
  photo_id: string;
  category: PhotoCategory | string;
  signed_url?: string | null;
  thumb_url?: string | null;
  photo_url?: string | null;
  notes?: string | null;
};

type OverrideAction = (
  state: QualityFormState,
  formData: FormData
) => Promise<QualityFormState>;

export function CheckoutEvidencePanel({
  workOrderId,
  required,
  photos,
  jobsComplete,
  qcComplete,
  canUpload,
  locked,
  canOverride = false,
  overrideAction,
  overridden = false,
  overrideReason = null,
}: {
  workOrderId: string;
  required: boolean;
  photos: CheckoutPhoto[];
  jobsComplete: boolean;
  qcComplete: boolean;
  canUpload: boolean;
  locked: boolean;
  canOverride?: boolean;
  overrideAction?: OverrideAction;
  overridden?: boolean;
  overrideReason?: string | null;
}) {
  const [overrideState, overrideFormAction] = useActionState(
    overrideAction ?? (async () => ({ error: null })),
    { error: null }
  );
  const [confirmOverride, setConfirmOverride] = useState(false);
  const [lightboxId, setLightboxId] = useState<string | null>(null);

  const coverage = useMemo(() => checkoutCoverageFromPhotos(photos), [photos]);
  const checkoutPhotos = useMemo(
    () =>
      photos.filter((photo) =>
        (CHECKOUT_PHOTO_CATEGORIES as readonly string[]).includes(photo.category)
      ),
    [photos]
  );
  const lightboxPhotos = useMemo(
    () => toLightboxPhotos(checkoutPhotos),
    [checkoutPhotos]
  );
  const lightboxIndex = lightboxId
    ? lightboxPhotos.findIndex((photo) => photo.id === lightboxId)
    : -1;

  if (!required) return null;

  const inputsEnabled = !locked && jobsComplete && qcComplete && canUpload;
  const missingCount = coverage.missing.length;

  function openBySrc(src: string) {
    const match = checkoutPhotos.find((photo) => {
      return photoFullUrl(photo) === src || photoPreviewUrl(photo) === src;
    });
    if (match) setLightboxId(match.photo_id);
  }

  return (
    <div className="mt-4 rounded border border-[var(--border)] p-4">
      <h3 className="font-semibold text-foreground">Checkout evidence</h3>
      <p className="mt-1 text-sm text-[var(--status-neutral)]">
        Five handoff photos of the finished bike. Mark Ready waits for these committed
        photos, not a queued upload.
      </p>
      {missingCount > 0 ? (
        <p className="mt-2 text-sm font-medium text-amber-900" role="status">
          {missingCount} checkout photo{missingCount === 1 ? "" : "s"} missing
          {coverage.covered.length > 0 ? ` · ${coverage.covered.length} saved` : ""}
        </p>
      ) : (
        <p className="mt-2 text-sm text-[var(--status-neutral)]" role="status">
          All five checkout photos are saved.
        </p>
      )}
      {!inputsEnabled && !locked ? (
        <p className="mt-2 text-sm text-[var(--status-neutral)]">
          Capture starts after jobs and quality check are complete enough to represent the
          final condition.
        </p>
      ) : null}
      {overridden ? (
        <p className="mt-2 text-sm text-amber-900">
          Emergency override recorded
          {overrideReason ? `: ${overrideReason}` : ""}. Mark Ready / Complete may proceed
          without the missing photos.
        </p>
      ) : null}

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {CHECKOUT_PHOTO_CATEGORIES.map((category) => {
          const existing = checkoutPhotos.filter((photo) => photo.category === category);
          return (
            <InspectionPhotoSlot
              key={category}
              workOrderId={workOrderId}
              category={category}
              label={PHOTO_CATEGORY_LABELS[category]}
              required
              readOnly={!inputsEnabled}
              existingUrls={existing
                .map((photo) => photoPreviewUrl(photo) ?? photoFullUrl(photo))
                .filter((url): url is string => Boolean(url))}
              onExpand={openBySrc}
            />
          );
        })}
      </div>

      {canOverride && !locked && !coverage.complete && overrideAction ? (
        <div className="mt-4 rounded border border-amber-300 bg-amber-50 p-3">
          <h4 className="text-sm font-semibold text-amber-950">Emergency exception</h4>
          <p className="mt-1 text-sm text-amber-950">
            Owner/manager only. This override does not erase photos or complete the visit.
            It only unlocks Mark Ready / Complete.
          </p>
          <FormError message={overrideState.error} />
          {confirmOverride ? (
            <form action={overrideFormAction} className="mt-3 flex flex-col gap-3">
              <TextAreaField
                label="Override reason"
                name="reason"
                rows={2}
                required
                maxLength={CHECKOUT_EVIDENCE_OVERRIDE_REASON_MAX_LENGTH}
              />
              <div className="flex flex-wrap gap-2">
                <SubmitButton label="Confirm emergency override" pendingLabel="Saving…" />
                <button
                  type="button"
                  className="min-h-11 rounded border border-[var(--border-strong)] px-4 py-2 text-sm font-medium text-foreground hover:bg-[var(--surface-muted)]"
                  onClick={() => setConfirmOverride(false)}
                >
                  Back
                </button>
              </div>
            </form>
          ) : (
            <button
              type="button"
              className="btn btn-secondary mt-3 min-h-11"
              onClick={() => setConfirmOverride(true)}
            >
              Record emergency override
            </button>
          )}
        </div>
      ) : null}

      {lightboxIndex >= 0 ? (
        <PhotoLightbox
          photos={lightboxPhotos}
          initialIndex={lightboxIndex}
          onClose={() => setLightboxId(null)}
        />
      ) : null}
    </div>
  );
}
