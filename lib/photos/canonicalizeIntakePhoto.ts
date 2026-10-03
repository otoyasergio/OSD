import "server-only";

import sharp, { type Sharp } from "sharp";
import { sniffImageMime } from "@/lib/forms/imageMime";
import { INTAKE_THUMB_MAX_EDGE } from "@/lib/photos/makeIntakeThumb";

export const INTAKE_PHOTO_MAX_EDGE = 4096;
export const INTAKE_PHOTO_MAX_SOURCE_BYTES = 10 * 1024 * 1024;
export const INTAKE_PHOTO_CONTENT_TYPE = "image/jpeg" as const;
export const INTAKE_PHOTO_SOFT_TARGET_BYTES = Math.floor(4.5 * 1024 * 1024);

const SUPPORTED_FORMATS = new Set(["jpeg", "png", "webp", "heif"]);
const JPEG_QUALITIES = [90, 88, 86, 84, 82] as const;

export type CanonicalIntakePhoto = {
  bytes: Buffer;
  width: number;
  height: number;
  contentType: typeof INTAKE_PHOTO_CONTENT_TYPE;
  byteSize: number;
};

export async function makeCanonicalIntakeThumbnail(
  canonicalBytes: Uint8Array
): Promise<Buffer> {
  return sharp(canonicalBytes, { failOn: "error" })
    .resize(INTAKE_THUMB_MAX_EDGE, INTAKE_THUMB_MAX_EDGE, {
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({ quality: 70, mozjpeg: true })
    .toBuffer();
}

async function decodeHeifFirstImage(source: Uint8Array): Promise<{
  width: number;
  height: number;
  data: Buffer;
}> {
  const loaded = await import("heic-decode");
  const decodeHeif =
    typeof loaded.default === "function"
      ? loaded.default
      : (loaded as unknown as (input: { buffer: Buffer }) => Promise<{
          width: number;
          height: number;
          data: ArrayLike<number>;
        }>);
  const image = await decodeHeif({ buffer: Buffer.from(source) });
  if (
    !image?.width ||
    !image.height ||
    !image.data ||
    image.data.length < image.width * image.height * 4
  ) {
    throw new Error("PHOTO_TYPE_INVALID");
  }
  return {
    width: image.width,
    height: image.height,
    data: Buffer.from(image.data as Uint8Array),
  };
}

async function encodeCanonicalJpeg(
  pipeline: Sharp
): Promise<{ data: Buffer; info: { width: number; height: number; size: number } }> {
  let encoded:
    { data: Buffer; info: { width: number; height: number; size: number } } | undefined;
  for (const quality of JPEG_QUALITIES) {
    const next = await pipeline
      .clone()
      .resize(INTAKE_PHOTO_MAX_EDGE, INTAKE_PHOTO_MAX_EDGE, {
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality, mozjpeg: true })
      .toBuffer({ resolveWithObject: true });
    encoded = next;
    if (next.data.byteLength <= INTAKE_PHOTO_SOFT_TARGET_BYTES) break;
  }
  if (!encoded) throw new Error("PHOTO_TYPE_INVALID");
  return encoded;
}

export async function canonicalizeIntakePhoto(
  source: Uint8Array
): Promise<CanonicalIntakePhoto> {
  if (source.byteLength === 0 || source.byteLength > INTAKE_PHOTO_MAX_SOURCE_BYTES) {
    throw new Error(source.byteLength === 0 ? "PHOTO_REQUIRED" : "PHOTO_TOO_LARGE");
  }

  try {
    if (sniffImageMime(source) === "image/heic") {
      const raw = await decodeHeifFirstImage(source);
      const encoded = await encodeCanonicalJpeg(
        sharp(raw.data, {
          raw: { width: raw.width, height: raw.height, channels: 4 },
        })
      );
      return {
        bytes: encoded.data,
        width: encoded.info.width,
        height: encoded.info.height,
        contentType: INTAKE_PHOTO_CONTENT_TYPE,
        byteSize: encoded.data.byteLength,
      };
    }

    const image = sharp(source, { failOn: "warning" });
    const metadata = await image.metadata();
    if (
      !metadata.format ||
      !SUPPORTED_FORMATS.has(metadata.format) ||
      !metadata.width ||
      !metadata.height
    ) {
      throw new Error("PHOTO_TYPE_INVALID");
    }

    const canKeepPreparedJpeg =
      metadata.format === "jpeg" &&
      (metadata.orientation == null || metadata.orientation === 1) &&
      Math.max(metadata.width, metadata.height) <= INTAKE_PHOTO_MAX_EDGE;

    if (canKeepPreparedJpeg) {
      // metadata() only reads the header; stats() forces a full decode so
      // truncated/corrupt JPEGs are never accepted as evidence objects.
      await sharp(source, { failOn: "warning" }).stats();

      const bytes = Buffer.from(source);
      return {
        bytes,
        width: metadata.width,
        height: metadata.height,
        contentType: INTAKE_PHOTO_CONTENT_TYPE,
        byteSize: bytes.byteLength,
      };
    }

    const encoded = await encodeCanonicalJpeg(
      sharp(source, { failOn: "warning" }).rotate()
    );
    return {
      bytes: encoded.data,
      width: encoded.info.width,
      height: encoded.info.height,
      contentType: INTAKE_PHOTO_CONTENT_TYPE,
      byteSize: encoded.data.byteLength,
    };
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message === "PHOTO_REQUIRED" ||
        error.message === "PHOTO_TOO_LARGE" ||
        error.message === "PHOTO_TYPE_INVALID")
    ) {
      throw error;
    }
    throw new Error("PHOTO_TYPE_INVALID");
  }
}
