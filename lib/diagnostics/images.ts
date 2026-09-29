import sharp from "sharp";
import type { DiagnosticsImageInput } from "@/lib/diagnostics/openai";

export const DIAGNOSTICS_MAX_SELECTED_IMAGES = 3;
export const DIAGNOSTICS_IMAGE_MAX_EDGE = 2_048;
export const DIAGNOSTICS_MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const DIAGNOSTICS_MAX_IMAGE_PURPOSE_CHARS = 500;

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
};

export type DiagnosticsImagePreparationResult = {
  images: DiagnosticsImageInput[];
  photoMetadata: DiagnosticsImagePersistenceMetadata[];
};

export type DiagnosticsImageDependencies = {
  loadRows: (photoIds: string[]) => Promise<DiagnosticsPhotoRow[]>;
  download: (storagePath: string) => Promise<Uint8Array>;
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
    limitInputPixels: options.maxEdge * options.maxEdge * 16,
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

function normalizePurpose(value: string): string {
  const purpose = value.trim();
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

function assertNormalizedJpeg(bytes: Uint8Array): Promise<void> {
  return sharp(bytes, {
    failOn: "error",
    limitInputPixels: DIAGNOSTICS_IMAGE_MAX_EDGE * DIAGNOSTICS_IMAGE_MAX_EDGE,
  })
    .metadata()
    .then((metadata) => {
      if (
        metadata.format !== "jpeg" ||
        !metadata.width ||
        !metadata.height ||
        metadata.width > DIAGNOSTICS_IMAGE_MAX_EDGE ||
        metadata.height > DIAGNOSTICS_IMAGE_MAX_EDGE
      ) {
        throw new Error("DIAGNOSTICS_IMAGE_NORMALIZATION_FAILED");
      }
    });
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
    if (
      JOB_SCOPED_CATEGORIES.has(row.category) &&
      (!row.jobId || (request.jobId && row.jobId !== request.jobId))
    ) {
      throw new Error("DIAGNOSTICS_IMAGE_JOB_MISMATCH");
    }
    if (!row.storagePath.trim()) {
      throw new Error("DIAGNOSTICS_IMAGE_STORAGE_PATH_INVALID");
    }
    return { selection, row };
  });

  const images: DiagnosticsImageInput[] = [];
  const photoMetadata: DiagnosticsImagePersistenceMetadata[] = [];
  const normalize = dependencies.normalizeImage ?? normalizeToJpeg;

  for (const [sortOrder, item] of ordered.entries()) {
    const downloaded = await dependencies.download(item.row.storagePath);
    if (
      !downloaded ||
      downloaded.byteLength === 0 ||
      downloaded.byteLength > DIAGNOSTICS_MAX_IMAGE_BYTES
    ) {
      throw new Error("DIAGNOSTICS_IMAGE_TOO_LARGE");
    }

    let normalized: Uint8Array;
    try {
      normalized = await normalize(downloaded, {
        maxEdge: DIAGNOSTICS_IMAGE_MAX_EDGE,
        maxBytes: DIAGNOSTICS_MAX_IMAGE_BYTES,
      });
      if (
        !normalized ||
        normalized.byteLength === 0 ||
        normalized.byteLength > DIAGNOSTICS_MAX_IMAGE_BYTES
      ) {
        throw new Error("DIAGNOSTICS_IMAGE_TOO_LARGE");
      }
      await assertNormalizedJpeg(normalized);
    } catch (error) {
      if (
        error instanceof Error &&
        (error.message === "DIAGNOSTICS_IMAGE_TOO_LARGE" ||
          error.message === "DIAGNOSTICS_IMAGE_NORMALIZATION_FAILED")
      ) {
        throw error;
      }
      throw new Error("DIAGNOSTICS_IMAGE_DECODE_FAILED", { cause: error });
    }

    images.push({
      dataUrl: `data:image/jpeg;base64,${Buffer.from(normalized).toString("base64")}`,
      detail: "high",
    });
    photoMetadata.push({
      photoId: item.row.photoId,
      purpose: normalizePurpose(item.selection.purpose),
      sortOrder,
    });
  }

  return { images, photoMetadata };
}
