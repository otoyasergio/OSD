"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { StaffGalleryPhoto } from "@/lib/services/photoGallery";
import { toLightboxPhotos } from "@/lib/photos/lightbox";
import { PhotoLightbox } from "@/components/photos/PhotoLightbox";
import { formatDateTime } from "@/lib/datetime/format";

export type StaffPhotoGridMode = "gallery" | "bike";

export function StaffPhotoGrid({
  photos,
  mode,
  emptyMessage,
}: {
  photos: StaffGalleryPhoto[];
  mode: StaffPhotoGridMode;
  emptyMessage: string;
}) {
  const [openId, setOpenId] = useState<string | null>(null);

  const lightboxPhotos = useMemo(
    () =>
      toLightboxPhotos(
        photos.map((photo) => ({
          photo_id: photo.photo_id,
          signed_url: photo.signed_url,
          category: photo.category,
          notes:
            mode === "gallery"
              ? [photo.motorcycle_label, photo.work_order_number, photo.notes]
                  .filter(Boolean)
                  .join(" · ")
              : [photo.work_order_number, formatDateTime(photo.created_at), photo.notes]
                  .filter(Boolean)
                  .join(" · "),
        }))
      ),
    [photos, mode]
  );

  const openIndex = openId
    ? lightboxPhotos.findIndex((photo) => photo.id === openId)
    : -1;

  if (photos.length === 0) {
    return (
      <p className="rounded border border-dashed border-[var(--border-strong)] bg-white px-4 py-8 text-center text-sm text-[var(--status-neutral)]">
        {emptyMessage}
      </p>
    );
  }

  return (
    <>
      <ul className="staff-photo-grid">
        {photos.map((photo) => (
          <li key={photo.photo_id} className="staff-photo-card">
            <button
              type="button"
              className="staff-photo-thumb"
              onClick={() => setOpenId(photo.photo_id)}
              aria-label={`View ${photo.category_label} photo`}
              disabled={!photo.signed_url}
            >
              {photo.signed_url ? (
                // eslint-disable-next-line @next/next/no-img-element -- signed storage URLs
                <img
                  src={photo.signed_url}
                  alt={photo.category_label}
                  className="staff-photo-img"
                  loading="lazy"
                />
              ) : (
                <span className="staff-photo-missing">Unavailable</span>
              )}
            </button>
            <div className="staff-photo-meta">
              <p className="staff-photo-category">{photo.category_label}</p>
              {mode === "gallery" ? (
                <p className="staff-photo-line">{photo.motorcycle_label}</p>
              ) : null}
              <p className="staff-photo-line">
                <Link
                  href={`/work_orders/${photo.work_order_id}`}
                  className="underline-offset-2 hover:underline"
                >
                  {photo.work_order_number}
                </Link>
                {mode === "gallery" && photo.motorcycle_id ? (
                  <>
                    {" · "}
                    <Link
                      href={`/motorcycles/${photo.motorcycle_id}`}
                      className="underline-offset-2 hover:underline"
                    >
                      Bike
                    </Link>
                  </>
                ) : null}
              </p>
              <p className="staff-photo-date">{formatDateTime(photo.created_at)}</p>
            </div>
          </li>
        ))}
      </ul>
      {openIndex >= 0 ? (
        <PhotoLightbox
          photos={lightboxPhotos}
          initialIndex={openIndex}
          onClose={() => setOpenId(null)}
        />
      ) : null}
    </>
  );
}
