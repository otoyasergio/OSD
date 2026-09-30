/** Shown when a library File cannot be read (typical iOS Safari after input reset). */
export const UNREADABLE_PHOTO_MESSAGE =
  "Could not read that photo. Try again, or use the camera instead.";

export const PHOTO_UPLOAD_RETRY_ATTEMPTS = 3;
export const PHOTO_UPLOAD_RETRY_BASE_MS = 400;

const RETRYABLE_FAILURE =
  /failed to fetch|networkerror|network request failed|load failed|timed? ?out|aborterror|internal server error|\b502\b|\b503\b|\b504\b|could not upload the photo/i;

/** Transient upload failures that are safe to retry with a new photo id. */
export function isRetryablePhotoUploadFailure(
  message: string | null | undefined
): boolean {
  if (!message) return false;
  return RETRYABLE_FAILURE.test(message);
}
