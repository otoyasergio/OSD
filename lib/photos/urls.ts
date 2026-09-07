/** Compressed card/grid preview. Falls back to the full signed URL. */
export function photoPreviewUrl(photo: {
  thumb_url?: string | null;
  signed_url?: string | null;
  photo_url?: string | null;
}): string | null {
  return photo.thumb_url || photo.signed_url || photo.photo_url || null;
}

/** Full-resolution URL for the open lightbox / inspection view. */
export function photoFullUrl(photo: {
  signed_url?: string | null;
  photo_url?: string | null;
}): string | null {
  return photo.signed_url || photo.photo_url || null;
}
