/**
 * Pure sizing and encode-ladder logic shared by the main-thread and Web Worker
 * compression paths. Nothing here touches the DOM, so it can run in a worker
 * and in node tests.
 */

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

const QUALITY_STEP = 0.08;
/** Never shrink the longest edge below this while chasing `maxBytes`. */
const MIN_DIMENSION = 640;
const MAX_ENCODE_ATTEMPTS = 10;
/**
 * iOS Safari through iOS 17 refuses canvases over 16,777,216 px (4096×4096):
 * drawing silently produces nothing and `toBlob` returns null. A square shot
 * at our 4096 long edge sits exactly on that line, so keep a margin.
 */
export const MAX_CANVAS_AREA = 16_000_000;

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

/**
 * Scale `source` so its longest edge is at most `maxDimension` and its area at
 * most `maxArea` (never upscales, keeps the aspect ratio).
 */
export function fitDimensions(
  source: ImageSize,
  maxDimension: number,
  maxArea = MAX_CANVAS_AREA
): ImageSize {
  let scale = Math.min(1, maxDimension / Math.max(source.width, source.height));
  const area = source.width * source.height * scale * scale;
  if (area > maxArea) scale *= Math.sqrt(maxArea / area);
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
 * Encode with `encode`, redrawing from `source` only when the target size
 * changes. Repeated dimension steps then never stack resampling blur, and
 * quality-only retries re-encode the pixels already on the canvas.
 */
export function redrawOnResize(
  draw: (width: number, height: number) => void,
  encode: EncodeImage
): EncodeImage {
  let drawn: ImageSize | null = null;
  return (width, height, quality) => {
    if (!drawn || drawn.width !== width || drawn.height !== height) {
      draw(width, height);
      drawn = { width, height };
    }
    return encode(width, height, quality);
  };
}
