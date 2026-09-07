export type CompressImageOptions = {
  /** Soft target; compression stops once under this size when possible. */
  maxBytes?: number;
  /** Longest edge after resize. */
  maxDimension?: number;
  /** Starting JPEG quality (0–1). */
  quality?: number;
  /** Floor JPEG quality — never go below this while retrying for size. */
  minQuality?: number;
};

/** Inspection-grade bike photos. Boards use a separate stored thumbnail. */
export const BIKE_PHOTO_COMPRESS: Required<CompressImageOptions> = {
  maxBytes: 4_500_000,
  maxDimension: 4096,
  quality: 0.9,
  minQuality: 0.82,
};

/** Paper agreements and other documents — size matters more than pixel detail. */
export const DOCUMENT_IMAGE_COMPRESS: Required<CompressImageOptions> = {
  maxBytes: 900_000,
  maxDimension: 1600,
  quality: 0.72,
  minQuality: 0.45,
};

/**
 * Downscale/re-encode camera photos so sequential uploads stay under
 * serverless body limits. Falls back to the original file on failure.
 *
 * Defaults keep bike photos large enough to inspect VIN, scratches, and
 * fasteners when opened full-screen.
 */
export async function compressImageForUpload(
  file: File,
  options: CompressImageOptions = {}
): Promise<File> {
  const maxBytes = options.maxBytes ?? BIKE_PHOTO_COMPRESS.maxBytes;
  const maxDimension = options.maxDimension ?? BIKE_PHOTO_COMPRESS.maxDimension;
  const minQuality = options.minQuality ?? BIKE_PHOTO_COMPRESS.minQuality;
  let quality = options.quality ?? BIKE_PHOTO_COMPRESS.quality;

  if (!(file instanceof File) || file.size === 0) return file;
  if (file.size <= maxBytes && file.type === "image/jpeg") return file;

  if (typeof document === "undefined") return file;

  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bitmap.close();
      return file;
    }
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();

    let blob: Blob | null = null;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      blob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob((result) => resolve(result), "image/jpeg", quality);
      });
      if (!blob) break;
      if (blob.size <= maxBytes) break;
      quality = Math.max(minQuality, quality - 0.08);
    }

    if (!blob || blob.size === 0) return file;

    const baseName = file.name.replace(/\.[^.]+$/, "") || "intake";
    return new File([blob], `${baseName}.jpg`, {
      type: "image/jpeg",
      lastModified: file.lastModified,
    });
  } catch {
    return file;
  }
}
