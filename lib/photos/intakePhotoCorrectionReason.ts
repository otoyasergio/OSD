export const PHOTO_CORRECTION_REASON_MAX_LENGTH = 500;

export function parseIntakePhotoCorrectionReason(reason: string): string {
  const trimmed = reason.trim();
  if (!trimmed) throw new Error("PHOTO_CORRECTION_REASON_REQUIRED");
  if (trimmed.length > PHOTO_CORRECTION_REASON_MAX_LENGTH) {
    throw new Error("PHOTO_CORRECTION_REASON_TOO_LONG");
  }
  return trimmed;
}
