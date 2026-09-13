import type { PhotoCategory } from "@/lib/database/types";
import { PHOTO_CATEGORY_LABELS } from "@/lib/status/labels";
import { photoFullUrl, photoPreviewUrl } from "@/lib/photos/urls";

export type LightboxPhoto = {
  id: string;
  /** Full-size image shown when the lightbox is open. */
  src: string;
  /** Compressed preview for strips and grids. Falls back to `src`. */
  previewSrc?: string;
  label: string;
  caption?: string | null;
};

export type LightboxSource = {
  photo_id: string;
  signed_url?: string | null;
  thumb_url?: string | null;
  photo_url?: string | null;
  category: PhotoCategory | string;
  notes?: string | null;
};

/** Map intake photos to lightbox entries, dropping ones with no viewable URL. */
export function toLightboxPhotos(photos: LightboxSource[]): LightboxPhoto[] {
  return photos.flatMap((photo) => {
    const src = photoFullUrl(photo);
    if (!src) return [];
    return [
      {
        id: photo.photo_id,
        src,
        previewSrc: photoPreviewUrl(photo) ?? src,
        label: PHOTO_CATEGORY_LABELS[photo.category as PhotoCategory] ?? photo.category,
        caption: photo.notes ?? null,
      },
    ];
  });
}
