import sharp from "sharp";
import type { DiagnosticsImageInput } from "@/lib/diagnostics/openai";

export const DIAGNOSTICS_MAX_SELECTED_IMAGES = 3;
export const DIAGNOSTICS_IMAGE_MAX_EDGE = 2_048;
export const DIAGNOSTICS_MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const DIAGNOSTICS_MAX_NORMALIZED_IMAGE_BYTES = 5 * 1024 * 1024;
export const DIAGNOSTICS_MAX_INPUT_PIXELS = 50_000_000;
export const DIAGNOSTICS_MAX_IMAGE_PURPOSE_CHARS = 500;
export const DIAGNOSTICS_HEIF_FALLBACK_LIMITATION =
  "Original HEIC/HEIF could not be decoded; lower-resolution JPEG thumbnail used.";

const ALLOWED_CATEGORIES = new Set([
  "inspection_tires",
  "inspection_brakes",
  "inspection_forks",
  "inspection_item",
  "job_work",
  "job_proof",
]);

const JOB_SCOPED_CATEGORIES = new Set(["job_work", "job_proof"]);

export type DiagnosticsPhotoRow = {
  photoId: string;
  workOrderId: string;
  jobId: string | null;
  category: string;
  storagePath: string;
  thumbStoragePath?: string | null;
};

export type DiagnosticsImageSelection = {
  photoId: string;
  purpose: string;
};

export type DiagnosticsImagePreparationRequest = {
  workOrderId: string;
  jobId?: string | null;
  selections: DiagnosticsImageSelection[];
};

export type DiagnosticsImagePersistenceMetadata = {
  photoId: string;
  purpose: string;
  sortOrder: number;
  limitation: string | null;
};

export type DiagnosticsImagePreparationResult = {
  images: DiagnosticsImageInput[];
  photoMetadata: DiagnosticsImagePersistenceMetadata[];
};

export type DiagnosticsImageDependencies = {
  loadRows: (photoIds: string[]) => Promise<DiagnosticsPhotoRow[]>;
  download: (storagePath: string, options: { maxBytes: number }) => Promise<Uint8Array>;
  inspectImage?: (bytes: Uint8Array) => Promise<{
    format: string;
    width: number;
    height: number;
  }>;
  normalizeImage?: (
    bytes: Uint8Array,
    options: { maxEdge: number; maxBytes: number }
  ) => Promise<Uint8Array>;
};

async function normalizeToJpeg(
  bytes: Uint8Array,
  options: { maxEdge: number; maxBytes: number }
): Promise<Uint8Array> {
  const output = await sharp(bytes, {
    failOn: "error",
    limitInputPixels: DIAGNOSTICS_MAX_INPUT_PIXELS,
  })
    .rotate()
    .resize(options.maxEdge, options.maxEdge, {
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({
      quality: 82,
      mozjpeg: true,
    })
    .toBuffer();

  if (output.byteLength === 0 || output.byteLength > options.maxBytes) {
    throw new Error("DIAGNOSTICS_IMAGE_TOO_LARGE");
  }
  return output;
}

type SupportedInputFormat = "jpeg" | "png" | "webp" | "heif";

function magicFormat(bytes: Uint8Array): SupportedInputFormat | null {
  const hex = Buffer.from(bytes.subarray(0, 16)).toString("hex");
  if (/^ffd8ff/.test(hex)) return "jpeg";
  if (/^89504e470d0a1a0a/.test(hex)) return "png";
  if (
    bytes.length >= 12 &&
    Buffer.from(bytes.subarray(0, 4)).toString("ascii") === "RIFF" &&
    Buffer.from(bytes.subarray(8, 12)).toString("ascii") === "WEBP"
  ) {
    return "webp";
  }
  if (
    bytes.length >= 12 &&
    Buffer.from(bytes.subarray(4, 8)).toString("ascii") === "ftyp" &&
    /^(?:heic|heix|hevc|hevx|mif1|msf1)$/.test(
      Buffer.from(bytes.subarray(8, 12)).toString("ascii")
    )
  ) {
    return "heif";
  }
  return null;
}

async function inspectWithSharp(bytes: Uint8Array): Promise<{
  format: string;
  width: number;
  height: number;
}> {
  const metadata = await sharp(bytes, {
    failOn: "error",
    limitInputPixels: false,
  }).metadata();
  return {
    format: metadata.format ?? "",
    width: metadata.width ?? 0,
    height: metadata.height ?? 0,
  };
}

async function assertSupportedInput(
  bytes: Uint8Array,
  inspectImage: NonNullable<DiagnosticsImageDependencies["inspectImage"]>
): Promise<{ format: SupportedInputFormat; width: number; height: number }> {
  const magic = magicFormat(bytes);
  if (!magic) throw new Error("DIAGNOSTICS_IMAGE_FORMAT_UNSUPPORTED");
  let metadata: Awaited<ReturnType<typeof inspectImage>>;
  try {
    metadata = await inspectImage(bytes);
  } catch (error) {
    throw new Error("DIAGNOSTICS_IMAGE_DECODE_FAILED", { cause: error });
  }
  const metadataFormat = metadata.format === "heic" ? "heif" : metadata.format;
  if (metadataFormat !== magic) {
    throw new Error("DIAGNOSTICS_IMAGE_FORMAT_UNSUPPORTED");
  }
  if (
    !Number.isSafeInteger(metadata.width) ||
    !Number.isSafeInteger(metadata.height) ||
    metadata.width <= 0 ||
    metadata.height <= 0
  ) {
    throw new Error("DIAGNOSTICS_IMAGE_DECODE_FAILED");
  }
  if (metadata.width * metadata.height > DIAGNOSTICS_MAX_INPUT_PIXELS) {
    throw new Error("DIAGNOSTICS_IMAGE_PIXEL_LIMIT");
  }
  return { format: magic, width: metadata.width, height: metadata.height };
}

function normalizePurpose(value: string): string {
  if (
    /(?:https?:\/\/|data:image\/|(?:^|\/)(?:storage|photos?|images?|signatures?|documents?|tokens?)(?:\/|$))/i.test(
      value
    )
  ) {
    throw new Error("DIAGNOSTICS_IMAGE_PURPOSE_INVALID");
  }
  const purpose = value
    .trim()
    .replace(/\b[A-HJ-NPR-Z0-9]{17}\b/gi, "[REDACTED_VIN]")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[REDACTED_EMAIL]")
    .replace(/(?:\+?1[\s.()-]*)?(?:\d[\s.()-]*){10}\b/g, "[REDACTED_PHONE]");
  if (!purpose || purpose.length > DIAGNOSTICS_MAX_IMAGE_PURPOSE_CHARS) {
    throw new Error("DIAGNOSTICS_IMAGE_PURPOSE_INVALID");
  }
  return purpose;
}

function assertSelections(request: DiagnosticsImagePreparationRequest): void {
  if (!request.workOrderId.trim()) {
    throw new Error("DIAGNOSTICS_IMAGE_WORK_ORDER_INVALID");
  }
  if (request.selections.length > DIAGNOSTICS_MAX_SELECTED_IMAGES) {
    throw new Error("DIAGNOSTICS_IMAGE_SELECTION_LIMIT");
  }

  const ids = new Set<string>();
  for (const selection of request.selections) {
    if (!selection.photoId.trim()) {
      throw new Error("DIAGNOSTICS_IMAGE_ID_INVALID");
    }
    if (ids.has(selection.photoId)) {
      throw new Error("DIAGNOSTICS_IMAGE_DUPLICATE");
    }
    ids.add(selection.photoId);
    normalizePurpose(selection.purpose);
  }
}

async function assertNormalizedJpeg(bytes: Uint8Array): Promise<void> {
  try {
    const metadata = await sharp(bytes, {
      failOn: "error",
      limitInputPixels: DIAGNOSTICS_MAX_INPUT_PIXELS,
    }).metadata();
    if (
      metadata.format !== "jpeg" ||
      !metadata.width ||
      !metadata.height ||
      metadata.width > DIAGNOSTICS_IMAGE_MAX_EDGE ||
      metadata.height > DIAGNOSTICS_IMAGE_MAX_EDGE
    ) {
      throw new Error("DIAGNOSTICS_IMAGE_NORMALIZATION_FAILED");
    }
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "DIAGNOSTICS_IMAGE_NORMALIZATION_FAILED"
    ) {
      throw error;
    }
    throw new Error("DIAGNOSTICS_IMAGE_NORMALIZATION_FAILED", { cause: error });
  }
}

export async function prepareDiagnosticsImages(
  request: DiagnosticsImagePreparationRequest,
  dependencies: DiagnosticsImageDependencies
): Promise<DiagnosticsImagePreparationResult> {
  assertSelections(request);
  if (request.selections.length === 0) {
    return { images: [], photoMetadata: [] };
  }

  const requestedIds = request.selections.map((selection) => selection.photoId);
  const rows = await dependencies.loadRows(requestedIds);
  const rowsById = new Map<string, DiagnosticsPhotoRow>();
  for (const row of rows) {
    if (rowsById.has(row.photoId)) {
      throw new Error("DIAGNOSTICS_IMAGE_ROW_DUPLICATE");
    }
    if (!requestedIds.includes(row.photoId)) {
      throw new Error("DIAGNOSTICS_IMAGE_NOT_SELECTED");
    }
    rowsById.set(row.photoId, row);
  }

  const ordered = request.selections.map((selection) => {
    const row = rowsById.get(selection.photoId);
    if (!row) throw new Error("DIAGNOSTICS_IMAGE_NOT_FOUND");
    if (row.workOrderId !== request.workOrderId) {
      throw new Error("DIAGNOSTICS_IMAGE_WORK_ORDER_MISMATCH");
    }
    if (!ALLOWED_CATEGORIES.has(row.category)) {
      throw new Error("DIAGNOSTICS_IMAGE_CATEGORY_NOT_ALLOWED");
    }
    if (JOB_SCOPED_CATEGORIES.has(row.category)) {
      if (!request.jobId) {
        throw new Error("DIAGNOSTICS_IMAGE_JOB_REQUIRED");
      }
      if (!row.jobId || row.jobId !== request.jobId) {
        throw new Error("DIAGNOSTICS_IMAGE_JOB_MISMATCH");
      }
    }
    if (!row.storagePath.trim()) {
      throw new Error("DIAGNOSTICS_IMAGE_STORAGE_PATH_INVALID");
    }
    return { selection, row };
  });

  const images: DiagnosticsImageInput[] = [];
  const photoMetadata: DiagnosticsImagePersistenceMetadata[] = [];
  const normalize = dependencies.normalizeImage ?? normalizeToJpeg;
  const inspectImage = dependencies.inspectImage ?? inspectWithSharp;

  for (const [sortOrder, item] of ordered.entries()) {
    const downloaded = await dependencies.download(item.row.storagePath, {
      maxBytes: DIAGNOSTICS_MAX_IMAGE_BYTES,
    });
    if (
      !downloaded ||
      downloaded.byteLength === 0 ||
      downloaded.byteLength > DIAGNOSTICS_MAX_IMAGE_BYTES
    ) {
      throw new Error("DIAGNOSTICS_IMAGE_TOO_LARGE");
    }

    let inputMetadata: Awaited<ReturnType<typeof assertSupportedInput>> | undefined;
    let normalized: Uint8Array | undefined;
    let limitation: string | null = null;
    try {
      inputMetadata = await assertSupportedInput(downloaded, inspectImage);
    } catch (metadataError) {
      if (magicFormat(downloaded) !== "heif" || !item.row.thumbStoragePath) {
        throw metadataError;
      }
    }

    if (!inputMetadata) {
      const thumbnail = await dependencies.download(item.row.thumbStoragePath!, {
        maxBytes: DIAGNOSTICS_MAX_IMAGE_BYTES,
      });
      if (
        !thumbnail ||
        thumbnail.byteLength === 0 ||
        thumbnail.byteLength > DIAGNOSTICS_MAX_IMAGE_BYTES
      ) {
        throw new Error("DIAGNOSTICS_IMAGE_TOO_LARGE");
      }
      const thumbnailMetadata = await assertSupportedInput(thumbnail, inspectImage);
      if (thumbnailMetadata.format !== "jpeg") {
        throw new Error("DIAGNOSTICS_IMAGE_FORMAT_UNSUPPORTED");
      }
      try {
        normalized = await normalize(thumbnail, {
          maxEdge: DIAGNOSTICS_IMAGE_MAX_EDGE,
          maxBytes: DIAGNOSTICS_MAX_NORMALIZED_IMAGE_BYTES,
        });
        limitation = DIAGNOSTICS_HEIF_FALLBACK_LIMITATION;
      } catch (fallbackError) {
        throw new Error("DIAGNOSTICS_IMAGE_DECODE_FAILED", {
          cause: fallbackError,
        });
      }
    } else {
      try {
        normalized = await normalize(downloaded, {
          maxEdge: DIAGNOSTICS_IMAGE_MAX_EDGE,
          maxBytes: DIAGNOSTICS_MAX_NORMALIZED_IMAGE_BYTES,
        });
      } catch (error) {
        if (inputMetadata.format === "heif" && item.row.thumbStoragePath) {
          const thumbnail = await dependencies.download(item.row.thumbStoragePath, {
            maxBytes: DIAGNOSTICS_MAX_IMAGE_BYTES,
          });
          if (
            !thumbnail ||
            thumbnail.byteLength === 0 ||
            thumbnail.byteLength > DIAGNOSTICS_MAX_IMAGE_BYTES
          ) {
            throw new Error("DIAGNOSTICS_IMAGE_TOO_LARGE");
          }
          const thumbnailMetadata = await assertSupportedInput(thumbnail, inspectImage);
          if (thumbnailMetadata.format !== "jpeg") {
            throw new Error("DIAGNOSTICS_IMAGE_FORMAT_UNSUPPORTED");
          }
          try {
            normalized = await normalize(thumbnail, {
              maxEdge: DIAGNOSTICS_IMAGE_MAX_EDGE,
              maxBytes: DIAGNOSTICS_MAX_NORMALIZED_IMAGE_BYTES,
            });
            limitation = DIAGNOSTICS_HEIF_FALLBACK_LIMITATION;
          } catch (fallbackError) {
            throw new Error("DIAGNOSTICS_IMAGE_DECODE_FAILED", {
              cause: fallbackError,
            });
          }
        } else {
          if (
            error instanceof Error &&
            (error.message === "DIAGNOSTICS_IMAGE_TOO_LARGE" ||
              error.message === "DIAGNOSTICS_IMAGE_NORMALIZATION_FAILED")
          ) {
            throw error;
          }
          throw new Error("DIAGNOSTICS_IMAGE_DECODE_FAILED", { cause: error });
        }
      }
    }
    if (
      !normalized ||
      normalized.byteLength === 0 ||
      normalized.byteLength > DIAGNOSTICS_MAX_NORMALIZED_IMAGE_BYTES
    ) {
      throw new Error("DIAGNOSTICS_IMAGE_TOO_LARGE");
    }
    await assertNormalizedJpeg(normalized);

    images.push({
      photoId: item.row.photoId,
      purpose: normalizePurpose(item.selection.purpose),
      limitation,
      dataUrl: `data:image/jpeg;base64,${Buffer.from(normalized).toString("base64")}`,
      detail: "high",
    });
    photoMetadata.push({
      photoId: item.row.photoId,
      purpose: normalizePurpose(item.selection.purpose),
      sortOrder,
      limitation,
    });
  }

  return { images, photoMetadata };
}
