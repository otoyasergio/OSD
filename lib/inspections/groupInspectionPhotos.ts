import { photoPreviewUrl } from "@/lib/photos/urls";

export type InspectionPhotoRef = {
  photo_id?: string;
  category: string;
  inspection_result_id?: string | null;
  signed_url?: string | null;
  thumb_url?: string | null;
  photo_url?: string | null;
};

export { photoFullUrl, photoPreviewUrl } from "@/lib/photos/urls";

export function photoViewUrl(photo: {
  thumb_url?: string | null;
  signed_url?: string | null;
  photo_url?: string | null;
}): string | null {
  return photoPreviewUrl(photo);
}

/** All photos linked to each inspection item — never first-wins. */
export function groupInspectionPhotosByResult<T extends InspectionPhotoRef>(
  photos: T[]
): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const photo of photos) {
    const resultId = photo.inspection_result_id;
    if (!resultId) continue;
    const list = map.get(resultId) ?? [];
    list.push(photo);
    map.set(resultId, list);
  }
  return map;
}

export function inspectionPhotosForCategory<T extends InspectionPhotoRef>(
  photos: T[],
  category: string
): T[] {
  return photos.filter((photo) => photo.category === category);
}

export function inspectionPhotoUrls(photos: InspectionPhotoRef[]): string[] {
  return photos.map(photoViewUrl).filter((url): url is string => Boolean(url));
}
