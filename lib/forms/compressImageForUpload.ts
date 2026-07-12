export type CompressImageOptions = {
  /** Soft target; compression stops once under this size when possible. */
  maxBytes?: number;
  /** Longest edge after resize. */
  maxDimension?: number;
  /** Starting JPEG quality (0–1). */
  quality?: number;
};

const DEFAULT_MAX_BYTES = 900_000;
const DEFAULT_MAX_DIMENSION = 1600;
const DEFAULT_QUALITY = 0.72;

/**
 * Downscale/re-encode camera photos so sequential uploads stay under
 * serverless body limits. Falls back to the original file on failure.
 */
export async function compressImageForUpload(
  file: File,
  options: CompressImageOptions = {}
): Promise<File> {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxDimension = options.maxDimension ?? DEFAULT_MAX_DIMENSION;
  let quality = options.quality ?? DEFAULT_QUALITY;

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
      quality = Math.max(0.45, quality - 0.12);
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
