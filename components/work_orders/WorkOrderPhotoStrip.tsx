import type { IntakePhoto } from "@/lib/services/photos";
import { PHOTO_CATEGORY_LABELS } from "@/lib/status/labels";

export function WorkOrderPhotoStrip({ photos }: { photos: IntakePhoto[] }) {
  if (photos.length === 0) return null;

  const ordered = [...photos].sort((a, b) => {
    if (a.category === "front" && b.category !== "front") return -1;
    if (b.category === "front" && a.category !== "front") return 1;
    return b.created_at.localeCompare(a.created_at);
  });

  return (
    <div className="wo-photo-strip" aria-label="Intake photos">
      <div className="wo-photo-strip-track">
        {ordered.map((photo) => {
          const src = photo.signed_url ?? photo.photo_url;
          if (!src) return null;
          const label =
            PHOTO_CATEGORY_LABELS[
              photo.category as keyof typeof PHOTO_CATEGORY_LABELS
            ] ?? photo.category;
          return (
            <a
              key={photo.photo_id}
              href={src}
              target="_blank"
              rel="noreferrer"
              className="wo-photo-strip-item"
              title={label}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- signed storage URLs */}
              <img src={src} alt={label} className="wo-photo-strip-img" />
            </a>
          );
        })}
      </div>
    </div>
  );
}
