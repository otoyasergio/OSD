"use client";

import { useMemo, useState } from "react";
import type { IntakePhoto } from "@/lib/services/photos";
import { toLightboxPhotos } from "@/lib/photos/lightbox";
import { PhotoLightbox } from "@/components/photos/PhotoLightbox";

export function WorkOrderPhotoStrip({ photos }: { photos: IntakePhoto[] }) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  const lightboxPhotos = useMemo(() => {
    const ordered = [...photos].sort((a, b) => {
      if (a.category === "front" && b.category !== "front") return -1;
      if (b.category === "front" && a.category !== "front") return 1;
      return b.created_at.localeCompare(a.created_at);
    });
    return toLightboxPhotos(ordered);
  }, [photos]);

  if (lightboxPhotos.length === 0) return null;

  return (
    <div className="wo-photo-strip" aria-label="Intake photos">
      <div className="wo-photo-strip-track">
        {lightboxPhotos.map((photo, index) => (
          <button
            key={photo.id}
            type="button"
            className="wo-photo-strip-item"
            title={photo.label}
            aria-label={`View ${photo.label} photo`}
            onClick={() => setOpenIndex(index)}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- signed storage URLs */}
            <img src={photo.src} alt={photo.label} className="wo-photo-strip-img" />
          </button>
        ))}
      </div>
      {openIndex !== null ? (
        <PhotoLightbox
          photos={lightboxPhotos}
          initialIndex={openIndex}
          onClose={() => setOpenIndex(null)}
        />
      ) : null}
    </div>
  );
}
