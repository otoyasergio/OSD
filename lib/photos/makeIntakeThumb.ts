import sharp from "sharp";

/** Longest edge for board / gallery / strip previews. */
export const INTAKE_THUMB_MAX_EDGE = 480;

/**
 * Build a small JPEG from an already-decoded bike photo. Used for cards and
 * grids so the stored original can stay inspection-quality.
 */
export async function makeIntakeThumb(bytes: Uint8Array): Promise<Buffer | null> {
  if (bytes.byteLength === 0) return null;
  try {
    return await sharp(bytes)
      .rotate()
      .resize(INTAKE_THUMB_MAX_EDGE, INTAKE_THUMB_MAX_EDGE, {
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality: 70, mozjpeg: true })
      .toBuffer();
  } catch {
    return null;
  }
}

export function intakeThumbStoragePath(originalPath: string): string {
  const lastDot = originalPath.lastIndexOf(".");
  if (lastDot <= 0) return `${originalPath}.thumb.jpg`;
  return `${originalPath.slice(0, lastDot)}.thumb.jpg`;
}
