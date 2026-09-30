export type CompressImageOptions = {
  /**
   * Ceiling on the encoded output. Quality drops to `minQuality` first; if the
   * photo is still too large the longest edge is scaled down until it fits.
   */
  maxBytes?: number;
  /** Longest edge after resize. */
  maxDimension?: number;
  /** Starting JPEG quality (0–1). */
  quality?: number;
  /** Floor JPEG quality — dimensions shrink before quality goes below this. */
  minQuality?: number;
};

/**
 * Inspection-grade bike photos. Boards use a separate stored thumbnail.
 *
 * `maxBytes` must stay under `SERVER_ACTION_UPLOAD_MAX_BYTES` (see
 * `lib/forms/uploadLimits.ts`): every upload in the app is one Server Action
 * call, and Vercel drops bodies over 4.5 MB before the app runs. A unit test
 * pins the relationship.
 */
export const BIKE_PHOTO_COMPRESS: Required<CompressImageOptions> = {
  maxBytes: 3_500_000,
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

const QUALITY_STEP = 0.08;
/** Never shrink the longest edge below this while chasing `maxBytes`. */
const MIN_DIMENSION = 640;
const MAX_ENCODE_ATTEMPTS = 10;

export type ImageSize = { width: number; height: number };

export type EncodeImage = (
  width: number,
  height: number,
  quality: number
) => Promise<Blob | null>;

export type FittedImage = {
  blob: Blob;
  width: number;
  height: number;
  quality: number;
};

/** Scale `source` so its longest edge is at most `maxDimension` (never upscales). */
export function fitDimensions(source: ImageSize, maxDimension: number): ImageSize {
  const scale = Math.min(1, maxDimension / Math.max(source.width, source.height));
  return {
    width: Math.max(1, Math.round(source.width * scale)),
    height: Math.max(1, Math.round(source.height * scale)),
  };
}

/**
 * Re-encode until the output is at most `maxBytes`.
 *
 * Order: start at `quality`, step down to `minQuality`, then scale the
 * dimensions. JPEG size tracks pixel count, so each dimension step estimates
 * the scale needed from the last encode instead of shrinking blindly. The
 * smallest encode seen is returned when the ladder runs out.
 */
export async function fitEncodedImage(
  encode: EncodeImage,
  source: ImageSize,
  options: Required<CompressImageOptions>
): Promise<FittedImage | null> {
  let { width, height } = fitDimensions(source, options.maxDimension);
  let quality = options.quality;
  let best: FittedImage | null = null;

  for (let attempt = 0; attempt < MAX_ENCODE_ATTEMPTS; attempt += 1) {
    const blob = await encode(width, height, quality);
    if (!blob || blob.size === 0) break;

    const candidate = { blob, width, height, quality };
    if (!best || blob.size < best.blob.size) best = candidate;
    if (blob.size <= options.maxBytes) return candidate;

    if (quality - options.minQuality > 1e-6) {
      quality = Math.max(
        options.minQuality,
        Math.round((quality - QUALITY_STEP) * 100) / 100
      );
      continue;
    }

    const longest = Math.max(width, height);
    if (longest <= MIN_DIMENSION) break;
    const estimate = Math.sqrt(options.maxBytes / blob.size) * 0.95;
    const factor = Math.min(0.9, Math.max(0.5, estimate));
    const nextLongest = Math.max(MIN_DIMENSION, Math.round(longest * factor));
    if (nextLongest >= longest) break;
    ({ width, height } = fitDimensions({ width, height }, nextLongest));
  }

  return best;
}

/**
 * Downscale/re-encode camera photos so each upload fits in one Server Action
 * request. Falls back to the original file when the browser cannot decode it;
 * callers check the size before sending.
 *
 * Defaults keep bike photos large enough to inspect VIN, scratches, and
 * fasteners when opened full-screen.
 */
export async function compressImageForUpload(
  file: File,
  options: CompressImageOptions = {}
): Promise<File> {
  const resolved: Required<CompressImageOptions> = {
    maxBytes: options.maxBytes ?? BIKE_PHOTO_COMPRESS.maxBytes,
    maxDimension: options.maxDimension ?? BIKE_PHOTO_COMPRESS.maxDimension,
    quality: options.quality ?? BIKE_PHOTO_COMPRESS.quality,
    minQuality: options.minQuality ?? BIKE_PHOTO_COMPRESS.minQuality,
  };

  if (!(file instanceof File) || file.size === 0) return file;
  if (file.size <= resolved.maxBytes && file.type === "image/jpeg") return file;

  if (typeof document === "undefined") return file;

  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await decodeImageBitmap(file, resolved.maxDimension);
    const source = bitmap;

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;

    // Redraw from the decoded bitmap whenever the size changes so repeated
    // dimension steps do not stack resampling blur; quality-only retries
    // re-encode the pixels already on the canvas.
    let drawn: ImageSize | null = null;
    const encode: EncodeImage = async (width, height, quality) => {
      if (!drawn || drawn.width !== width || drawn.height !== height) {
        canvas.width = width;
        canvas.height = height;
        ctx.drawImage(source, 0, 0, width, height);
        drawn = { width, height };
      }
      return new Promise<Blob | null>((resolve) => {
        canvas.toBlob((result) => resolve(result), "image/jpeg", quality);
      });
    };

    const fitted = await fitEncodedImage(
      encode,
      { width: source.width, height: source.height },
      resolved
    );
    if (!fitted) return file;

    const baseName = file.name.replace(/\.[^.]+$/, "") || "intake";
    return new File([fitted.blob], `${baseName}.jpg`, {
      type: "image/jpeg",
      lastModified: file.lastModified,
    });
  } catch {
    return file;
  } finally {
    bitmap?.close();
  }
}

async function decodeImageBitmap(file: File, maxDimension: number): Promise<ImageBitmap> {
  // Resize while decoding so a 12MP camera shot is not fully expanded on the
  // main thread before the canvas step. Older browsers ignore the options.
  const resized: ImageBitmapOptions = {
    imageOrientation: "from-image",
    resizeWidth: maxDimension,
    resizeQuality: "medium",
  };
  try {
    return await createImageBitmap(file, resized);
  } catch {
    try {
      return await createImageBitmap(file);
    } catch {
      if (typeof Image === "undefined" || typeof URL === "undefined") {
        throw new Error("IMAGE_DECODE_FAILED");
      }
      const url = URL.createObjectURL(file);
      try {
        const image = await new Promise<HTMLImageElement>((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = () => reject(new Error("IMAGE_DECODE_FAILED"));
          img.src = url;
        });
        return await createImageBitmap(image);
      } finally {
        URL.revokeObjectURL(url);
      }
    }
  }
}
