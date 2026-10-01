import "server-only";

import type { PhotoCategory } from "@/lib/database/types";
import type { CanonicalIntakePhoto } from "@/lib/photos/canonicalizeIntakePhoto";
import { intakeThumbStoragePath } from "@/lib/photos/makeIntakeThumb";

export type IntakePhotoUploadInput = {
  workOrderId: string;
  uploadedByUserId: string;
  clientUploadId: string | null;
  category: PhotoCategory;
  notes: string | null;
  inspectionResultId: string | null;
  jobId: string | null;
  sourceBytes: Uint8Array;
};

export type IntakePhotoInsert = {
  photo_id: string;
  work_order_id: string;
  uploaded_by_user_id: string;
  storage_path: string;
  thumb_storage_path: string | null;
  photo_url: null;
  category: PhotoCategory;
  notes: string | null;
  inspection_result_id: string | null;
  job_id: string | null;
  client_upload_id: string | null;
  content_type: "image/jpeg";
  byte_size: number;
  pixel_width: number;
  pixel_height: number;
};

export type IntakePhotoUploadRow = Omit<
  IntakePhotoInsert,
  "uploaded_by_user_id" | "photo_url"
> & {
  uploaded_by_user_id: string | null;
  photo_url: string | null;
  created_at: string;
};

export type IntakePhotoStorageUpload = {
  path: string;
  bytes: Uint8Array;
  contentType: "image/jpeg";
  upsert: false;
};

export type IntakePhotoUploadDependencies = {
  createPhotoId(): string;
  findPhotoByClientUploadId(clientUploadId: string): Promise<IntakePhotoUploadRow | null>;
  prepareCanonicalPhoto(source: Uint8Array): Promise<CanonicalIntakePhoto>;
  makeThumbnail(canonicalBytes: Uint8Array): Promise<Uint8Array>;
  uploadObject(upload: IntakePhotoStorageUpload): Promise<void>;
  removeObjects(paths: string[]): Promise<void>;
  insertPhoto(insert: IntakePhotoInsert): Promise<IntakePhotoUploadRow>;
  logThumbnailFailure(details: {
    workOrderId: string;
    photoId: string;
    stage: "generate" | "upload";
    statusCode?: string;
  }): void;
};

function matchesUploadLinkage(
  photo: IntakePhotoUploadRow,
  input: IntakePhotoUploadInput
): boolean {
  return (
    photo.work_order_id === input.workOrderId &&
    photo.category === input.category &&
    (photo.job_id ?? null) === input.jobId &&
    (photo.inspection_result_id ?? null) === input.inspectionResultId
  );
}

function existingPhotoForInput(
  photo: IntakePhotoUploadRow,
  input: IntakePhotoUploadInput
): IntakePhotoUploadRow {
  if (!matchesUploadLinkage(photo, input)) {
    throw new Error("PHOTO_UPLOAD_ID_CONFLICT");
  }
  return photo;
}

function storageStatusCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("statusCode" in error)) {
    return undefined;
  }
  const value = error.statusCode;
  return value == null ? undefined : String(value);
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "23505"
  );
}

export async function orchestrateIntakePhotoUpload(
  input: IntakePhotoUploadInput,
  dependencies: IntakePhotoUploadDependencies
): Promise<IntakePhotoUploadRow> {
  if (input.clientUploadId) {
    const existing = await dependencies.findPhotoByClientUploadId(input.clientUploadId);
    if (existing) return existingPhotoForInput(existing, input);
  }

  const canonical = await dependencies.prepareCanonicalPhoto(input.sourceBytes);
  const photoId = dependencies.createPhotoId();
  const storagePath = `${input.workOrderId}/${input.category}/${photoId}.jpg`;
  const candidateThumbStoragePath = intakeThumbStoragePath(storagePath);
  const storedPaths = [storagePath];

  await dependencies.uploadObject({
    path: storagePath,
    bytes: canonical.bytes,
    contentType: canonical.contentType,
    upsert: false,
  });

  let thumbStoragePath: string | null = null;
  let thumbnailStage: "generate" | "upload" = "generate";
  try {
    const thumbnail = await dependencies.makeThumbnail(canonical.bytes);
    thumbnailStage = "upload";
    await dependencies.uploadObject({
      path: candidateThumbStoragePath,
      bytes: thumbnail,
      contentType: "image/jpeg",
      upsert: false,
    });
    thumbStoragePath = candidateThumbStoragePath;
    storedPaths.push(candidateThumbStoragePath);
  } catch (error) {
    dependencies.logThumbnailFailure({
      workOrderId: input.workOrderId,
      photoId,
      stage: thumbnailStage,
      ...(storageStatusCode(error) ? { statusCode: storageStatusCode(error) } : {}),
    });
  }

  const insert: IntakePhotoInsert = {
    photo_id: photoId,
    work_order_id: input.workOrderId,
    uploaded_by_user_id: input.uploadedByUserId,
    storage_path: storagePath,
    thumb_storage_path: thumbStoragePath,
    photo_url: null,
    category: input.category,
    notes: input.notes,
    inspection_result_id: input.inspectionResultId,
    job_id: input.jobId,
    client_upload_id: input.clientUploadId,
    content_type: canonical.contentType,
    byte_size: canonical.byteSize,
    pixel_width: canonical.width,
    pixel_height: canonical.height,
  };

  try {
    return await dependencies.insertPhoto(insert);
  } catch (error) {
    if (input.clientUploadId) {
      let found: IntakePhotoUploadRow | null = null;
      let lookupFailed = false;
      try {
        found = await dependencies.findPhotoByClientUploadId(input.clientUploadId);
      } catch {
        lookupFailed = true;
      }
      if (found) {
        const committedThisCandidate =
          found.photo_id === photoId || found.storage_path === storagePath;
        if (committedThisCandidate) {
          return existingPhotoForInput(found, input);
        }
        await dependencies.removeObjects(storedPaths);
        return existingPhotoForInput(found, input);
      }
      // Ambiguous non-unique errors may have committed. If lookup also failed,
      // leave objects for replay instead of deleting a possibly-live row.
      if (!lookupFailed || isUniqueViolation(error)) {
        await dependencies.removeObjects(storedPaths);
      }
      throw new Error("PHOTO_UPLOAD_FAILED");
    }
    await dependencies.removeObjects(storedPaths);
    throw error;
  }
}
