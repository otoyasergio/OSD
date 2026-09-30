import {
  SERVER_ACTION_UPLOAD_MAX_BYTES,
  formatMegabytes,
} from "@/lib/forms/uploadLimits";

/** Shown when a library File cannot be read (typical iOS Safari after input reset). */
export const UNREADABLE_PHOTO_MESSAGE =
  "Could not read that photo. Try again, or use the camera instead.";

/** Generic, retryable upload failure (mirrors the server's PHOTO_UPLOAD_FAILED). */
export const PHOTO_UPLOAD_FAILED_MESSAGE = "Could not upload the photo. Try again.";

/** Network dropped mid-upload — retryable. */
export const PHOTO_UPLOAD_CONNECTION_MESSAGE =
  "Lost connection while uploading. Check your signal and try again.";

/**
 * The request was refused for size. Not retryable: the same bytes will be
 * refused again, so the person has to pick or take a different photo.
 */
export const PHOTO_TOO_LARGE_TO_UPLOAD_MESSAGE = `That photo is too large to upload (the limit is ${formatMegabytes(
  SERVER_ACTION_UPLOAD_MAX_BYTES
)} per photo). Take it again with the camera or choose a smaller photo.`;

export const PHOTO_UPLOAD_RETRY_ATTEMPTS = 3;
export const PHOTO_UPLOAD_RETRY_BASE_MS = 400;

const RETRYABLE_FAILURE =
  /failed to fetch|networkerror|network request failed|load failed|lost connection|timed? ?out|aborterror|internal server error|\b502\b|\b503\b|\b504\b|could not upload the photo/i;

/**
 * Vercel's 413 for bodies over 4.5 MB and Next's own `bodySizeLimit` guard.
 * Next's client-side "An unexpected response was received from the server"
 * is deliberately not matched: it also covers expired sessions and 500s.
 */
const PAYLOAD_TOO_LARGE =
  /\b413\b|payload[ _-]?too[ _-]?large|entity too large|body exceeded|body size limit|request body too large/i;

const OWN_MESSAGES = new Set([
  UNREADABLE_PHOTO_MESSAGE,
  PHOTO_UPLOAD_FAILED_MESSAGE,
  PHOTO_UPLOAD_CONNECTION_MESSAGE,
  PHOTO_TOO_LARGE_TO_UPLOAD_MESSAGE,
]);

/** Transient upload failures that are safe to retry with a new photo id. */
export function isRetryablePhotoUploadFailure(
  message: string | null | undefined
): boolean {
  if (!message) return false;
  return RETRYABLE_FAILURE.test(message);
}

export function isPayloadTooLargeFailure(message: string | null | undefined): boolean {
  if (!message) return false;
  return PAYLOAD_TOO_LARGE.test(message);
}

/**
 * Pre-send message for a file the client already knows the platform will
 * refuse. Includes the actual size so the person understands why the camera
 * shot that "looked fine" is being turned away.
 */
export function photoTooLargeMessage(
  file: { size: number; type?: string },
  noun = file.type === "application/pdf" ? "PDF" : "photo"
): string {
  const limit = formatMegabytes(SERVER_ACTION_UPLOAD_MAX_BYTES);
  const fix =
    noun === "PDF"
      ? "Export a smaller PDF or photograph the pages instead."
      : "Take it again with the camera or choose a smaller photo.";
  return `That ${noun} is ${formatMegabytes(file.size)} — over the ${limit} upload limit. ${fix}`;
}

/**
 * Turn an error *thrown* by a Server Action call (as opposed to an `{ error }`
 * result, which is already user-facing) into a message the shop can act on.
 * Thrown errors are framework or network failures, so the raw text is never
 * useful to a technician.
 */
export function describePhotoUploadFailure(error: unknown): string {
  const message =
    error instanceof Error ? error.message : typeof error === "string" ? error : "";
  if (OWN_MESSAGES.has(message)) return message;
  if (isPayloadTooLargeFailure(message)) return PHOTO_TOO_LARGE_TO_UPLOAD_MESSAGE;
  if (isRetryablePhotoUploadFailure(message)) return PHOTO_UPLOAD_CONNECTION_MESSAGE;
  return PHOTO_UPLOAD_FAILED_MESSAGE;
}
