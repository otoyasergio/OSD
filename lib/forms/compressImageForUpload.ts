import { isBrowserOffline } from "@/lib/forms/browserOnline";
import {
  fitEncodedImage,
  redrawOnResize,
  type CompressImageOptions,
  type EncodeImage,
  type FittedImage,
  type ImageSize,
} from "@/lib/forms/imageFit";
import { compressInWorker } from "@/lib/forms/compressImageWorker";

export {
  MAX_CANVAS_AREA,
  fitDimensions,
  fitEncodedImage,
  type CompressImageOptions,
  type EncodeImage,
  type FittedImage,
  type ImageSize,
} from "@/lib/forms/imageFit";
export { supportsWorkerCompression } from "@/lib/forms/compressImageWorker";

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

/**
 * Downscale/re-encode camera photos so each upload fits in one Server Action
 * request. Falls back to the original file when the browser cannot decode it;
 * callers check the size before sending.
 *
 * The work runs in a Web Worker when the browser supports it (Safari 16.4+ on
 * iPhone, iPad and Mac; Chrome; Firefox) so the form keeps responding while a
 * 12–24 MP capture is decoded and re-encoded. Older browsers, or a worker that
 * fails for any reason, use a `<canvas>` on the main thread.
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

  let fitted: FittedImage | null = null;
  // Offline, `new Worker(url)` hangs waiting for a chunk that cannot load.
  // Persist/queue the original (or main-thread JPEG) instead of waiting 45s.
  if (!isBrowserOffline()) {
    try {
      fitted = await compressInWorker(file, resolved);
    } catch {
      fitted = null;
    }
  }
  if (!fitted) fitted = await compressOnMainThread(file, resolved);
  if (!fitted) return file;

  const baseName = file.name.replace(/\.[^.]+$/, "") || "intake";
  return new File([fitted.blob], `${baseName}.jpg`, {
    type: "image/jpeg",
    lastModified: file.lastModified,
  });
}

async function compressOnMainThread(
  file: File,
  options: Required<CompressImageOptions>
): Promise<FittedImage | null> {
  if (typeof document === "undefined") return null;

  let decoded: DecodedImage | null = null;
  try {
    decoded = await decodeImage(file);
    const { source } = decoded;

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    const encode: EncodeImage = redrawOnResize(
      (width, height) => {
        canvas.width = width;
        canvas.height = height;
        ctx.drawImage(source, 0, 0, width, height);
      },
      (_width, _height, quality) =>
        new Promise<Blob | null>((resolve) => {
          canvas.toBlob((result) => resolve(result), "image/jpeg", quality);
        })
    );

    return await fitEncodedImage(
      encode,
      { width: decoded.width, height: decoded.height },
      options
    );
  } catch {
    return null;
  } finally {
    decoded?.release();
  }
}

type DecodedImage = ImageSize & {
  source: CanvasImageSource;
  release: () => void;
};

/**
 * Decode at native size, oriented per EXIF. Fitting happens on the canvas.
 *
 * No `resizeWidth` decode hint: with only one edge given, browsers keep the
 * aspect ratio, so a portrait iPhone shot (3024×4032) would be *upscaled* to
 * 4096×5461 — about 90 MB of bitmap on an iPad — and then drawn back down,
 * softer than the original. Native decode is bounded by the camera (~50 MB at
 * 12 MP, ~100 MB at 24 MP) and iOS already subsamples very large images.
 *
 * Fallbacks: Safari before 16 rejects the "from-image" enum but still applies
 * EXIF orientation by default; an `<img>` drawn straight to the canvas covers
 * browsers without `createImageBitmap` at all (respects EXIF since Safari 13.1).
 */
async function decodeImage(file: File): Promise<DecodedImage> {
  if (typeof createImageBitmap === "function") {
    try {
      return fromBitmap(
        await createImageBitmap(file, { imageOrientation: "from-image" })
      );
    } catch {
      try {
        return fromBitmap(await createImageBitmap(file));
      } catch {
        // Fall through to the element decoder below.
      }
    }
  }

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
    if (image.naturalWidth === 0 || image.naturalHeight === 0) {
      throw new Error("IMAGE_DECODE_FAILED");
    }
    return {
      source: image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      release: () => {
        URL.revokeObjectURL(url);
        image.src = "";
      },
    };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

function fromBitmap(bitmap: ImageBitmap): DecodedImage {
  return {
    source: bitmap,
    width: bitmap.width,
    height: bitmap.height,
    release: () => bitmap.close(),
  };
}
