"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { PhotoCategory } from "@/lib/database/types";
import {
  ADVISORY_REVIEW_BUCKETS,
  advisoriesInBucket,
  advisoryReviewBucketLabel,
  photosLinkedToAdvisory,
  type AdvisoryReviewBucket,
  type AdvisoryReviewItem,
  type AdvisoryReviewPhoto,
} from "@/lib/recommendations/advisoryReview";
import { toLightboxPhotos } from "@/lib/photos/lightbox";
import { photoPreviewUrl } from "@/lib/photos/urls";
import { PhotoLightbox } from "@/components/photos/PhotoLightbox";
import { RecoverableSignedImage } from "@/components/photos/RecoverableSignedImage";
import {
  PHOTO_CATEGORY_LABELS,
  RECOMMENDATION_SEVERITY_LABELS,
  RECOMMENDATION_STATUS_LABELS,
} from "@/lib/status/labels";

function photoLabel(category: string): string {
  if (category in PHOTO_CATEGORY_LABELS) {
    return PHOTO_CATEGORY_LABELS[category as PhotoCategory];
  }
  return category;
}

function PhotoThumb({
  photo,
  onOpen,
}: {
  photo: AdvisoryReviewPhoto;
  onOpen: (photoId: string) => void;
}) {
  const label = photoLabel(photo.category);
  const preview = photoPreviewUrl(photo);

  return (
    <figure className="overflow-hidden rounded border border-[var(--border)] bg-white">
      {preview ? (
        <button
          type="button"
          className="block w-full"
          aria-label={`Open ${label} photo`}
          onClick={() => onOpen(photo.photo_id)}
        >
          <RecoverableSignedImage
            src={preview}
            alt={label}
            className="aspect-[4/3] w-full object-cover bg-[var(--surface-muted)]"
          />
        </button>
      ) : (
        <div className="flex aspect-[4/3] items-center justify-center bg-[var(--surface-muted)] px-2 text-center text-sm text-[var(--status-neutral)]">
          Preview unavailable
        </div>
      )}
      <figcaption className="space-y-0.5 px-2 py-1.5">
        <p className="text-xs font-medium text-foreground">{label}</p>
        {photo.notes ? (
          <p className="text-xs text-[var(--status-neutral)]">{photo.notes}</p>
        ) : null}
      </figcaption>
    </figure>
  );
}

/**
 * Review surface opened from Client advisories: every photo on the visit,
 * then the advisories (optionally one summary group).
 */
export function AdvisoryReviewDialog({
  items,
  photos,
  bucket,
  onBucketChange,
  onClose,
}: {
  items: AdvisoryReviewItem[];
  photos: AdvisoryReviewPhoto[];
  bucket: AdvisoryReviewBucket;
  onBucketChange: (bucket: AdvisoryReviewBucket) => void;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const [lightboxPhotoId, setLightboxPhotoId] = useState<string | null>(null);
  const visible = advisoriesInBucket(items, bucket);
  const lightboxPhotos = useMemo(() => toLightboxPhotos(photos), [photos]);
  const lightboxIndex = lightboxPhotoId
    ? lightboxPhotos.findIndex((photo) => photo.id === lightboxPhotoId)
    : -1;

  useEffect(() => {
    const previous = document.activeElement;
    dialogRef.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (lightboxPhotoId) return;
      event.preventDefault();
      onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [lightboxPhotoId, onClose]);

  return createPortal(
    <>
      <div
        className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4"
        onClick={onClose}
      >
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-label="Photos and advisories"
          tabIndex={-1}
          className="flex max-h-[100dvh] w-full flex-col overflow-hidden bg-white outline-none sm:max-h-[90vh] sm:max-w-3xl sm:rounded sm:border sm:border-[var(--border)]"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="flex items-start justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
            <div>
              <h2 className="text-lg font-semibold text-foreground">
                Photos and advisories
              </h2>
              <p className="mt-1 text-sm text-[var(--status-neutral)]">
                Photos from this visit, with everything the techs flagged.
              </p>
            </div>
            <button
              type="button"
              className="btn btn-secondary min-h-11 shrink-0"
              aria-label="Close photos and advisories"
              onClick={onClose}
            >
              Close
            </button>
          </div>

          <div className="overflow-y-auto px-4 py-4">
            <div
              className="flex flex-wrap gap-2"
              role="group"
              aria-label="Advisory groups"
            >
              {ADVISORY_REVIEW_BUCKETS.map((value) => {
                const selected = value === bucket;
                const count = advisoriesInBucket(items, value).length;
                return (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={selected}
                    className={[
                      "min-h-11 rounded border px-3 py-2 text-sm font-semibold",
                      selected
                        ? "border-[var(--chrome)] bg-[var(--chrome)] text-white"
                        : "border-[var(--border-strong)] bg-white text-foreground",
                    ].join(" ")}
                    onClick={() => onBucketChange(value)}
                  >
                    {advisoryReviewBucketLabel(value)} ({count})
                  </button>
                );
              })}
            </div>

            <section className="mt-5" aria-label="Photos">
              <h3 className="text-base font-semibold text-foreground">Photos</h3>
              {photos.length === 0 ? (
                <p className="mt-2 text-sm text-[var(--status-neutral)]">
                  No photos on this work order yet.
                </p>
              ) : (
                <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {photos.map((photo) => (
                    <li key={photo.photo_id}>
                      <PhotoThumb photo={photo} onOpen={setLightboxPhotoId} />
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="mt-6" aria-label="Advisories">
              <h3 className="text-base font-semibold text-foreground">Advisories</h3>
              {bucket !== "all" ? (
                <p className="mt-1 text-sm text-[var(--status-neutral)]">
                  {advisoryReviewBucketLabel(bucket)}
                </p>
              ) : null}
              {visible.length === 0 ? (
                <p className="mt-2 text-sm text-[var(--status-neutral)]">
                  No advisories in this group.
                </p>
              ) : (
                <ul className="mt-3 flex flex-col gap-3">
                  {visible.map((item) => {
                    const linked = photosLinkedToAdvisory(
                      photos,
                      item.inspection_result_id
                    );
                    return (
                      <li
                        key={item.recommendation_id}
                        className="rounded border border-[var(--border)] bg-white p-3"
                      >
                        <h4 className="text-base font-semibold text-foreground">
                          {item.description}
                        </h4>
                        <p className="mt-1 text-sm text-[var(--status-neutral)]">
                          {RECOMMENDATION_SEVERITY_LABELS[item.severity]} ·{" "}
                          {RECOMMENDATION_STATUS_LABELS[item.status]}
                        </p>
                        {item.inspection_item_name ? (
                          <p className="mt-1 text-sm text-[var(--status-neutral)]">
                            From inspection: {item.inspection_item_name}
                          </p>
                        ) : null}
                        {item.notes ? (
                          <p className="mt-2 text-sm text-foreground">{item.notes}</p>
                        ) : null}
                        {linked.length > 0 ? (
                          <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                            {linked.map((photo) => (
                              <li key={photo.photo_id}>
                                <PhotoThumb photo={photo} onOpen={setLightboxPhotoId} />
                              </li>
                            ))}
                          </ul>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </div>
        </div>
      </div>
      {lightboxIndex >= 0 ? (
        <PhotoLightbox
          photos={lightboxPhotos}
          initialIndex={lightboxIndex}
          onClose={() => setLightboxPhotoId(null)}
        />
      ) : null}
    </>,
    document.body
  );
}
