import {
  fitEncodedImage,
  redrawOnResize,
  type CompressImageOptions,
  type FittedImage,
} from "@/lib/forms/imageFit";

/**
 * True when this realm can decode and encode photos without a document:
 * `createImageBitmap` + `OffscreenCanvas` (Safari 16.4+, Chrome 69+,
 * Firefox 105+). Available in Web Workers, which is where it earns its keep.
 */
export function hasOffscreenImagePipeline(): boolean {
  return typeof OffscreenCanvas === "function" && typeof createImageBitmap === "function";
}

/**
 * Decode at native size, oriented per EXIF.
 *
 * Safari before 16 rejects the "from-image" enum (older WebKit only knew
 * "none"/"flipY") but applies EXIF orientation by default, so a plain decode
 * is a safe second try.
 */
export async function decodeImageBitmap(file: Blob): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return await createImageBitmap(file);
  }
}

/**
 * Compress a photo through an `OffscreenCanvas`. Returns null when the realm
 * lacks the APIs or the canvas refuses the image, so the caller can fall back
 * to the `<canvas>` element path on the main thread.
 */
export async function compressWithOffscreenCanvas(
  file: Blob,
  options: Required<CompressImageOptions>
): Promise<FittedImage | null> {
  if (!hasOffscreenImagePipeline()) return null;

  const bitmap = await decodeImageBitmap(file);
  try {
    if (bitmap.width === 0 || bitmap.height === 0) return null;

    const canvas = new OffscreenCanvas(1, 1);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    const encode = redrawOnResize(
      (width, height) => {
        canvas.width = width;
        canvas.height = height;
        ctx.drawImage(bitmap, 0, 0, width, height);
      },
      async (_width, _height, quality) => {
        try {
          return await canvas.convertToBlob({ type: "image/jpeg", quality });
        } catch {
          return null;
        }
      }
    );

    return await fitEncodedImage(
      encode,
      { width: bitmap.width, height: bitmap.height },
      options
    );
  } finally {
    bitmap.close();
  }
}
