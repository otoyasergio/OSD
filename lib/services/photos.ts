import { requireUser, type AppUser } from "@/lib/auth/session";
import { createClient } from "@/lib/database/supabase-server";
import type { DbClient, PhotoCategory } from "@/lib/database/types";
import { addAuditLog } from "@/lib/audit/addAuditLog";
import { addTimelineEvent } from "@/lib/timeline/addTimelineEvent";
import { TimelineEventType } from "@/lib/timeline/events";
import {
  canEditWorkOrder,
  canCreateWorkOrder,
  canDeleteIntakePhoto,
  isFloorTech,
} from "@/lib/permissions";
import { intakePhotoSchema } from "@/lib/validation/schemas";
import { assertViewerCanAccessWorkOrderLocation } from "@/lib/workOrders/assignmentVisibility";
import { PHOTO_CATEGORY_LABELS } from "@/lib/status/labels";
import {
  canonicalizeIntakePhoto,
  INTAKE_PHOTO_MAX_SOURCE_BYTES,
  makeCanonicalIntakeThumbnail,
} from "@/lib/photos/canonicalizeIntakePhoto";
import {
  orchestrateIntakePhotoUpload,
  type IntakePhotoUploadRow,
} from "@/lib/photos/intakePhotoUploadOrchestrator";
import { INTAKE_PHOTO_BUCKET, signStoragePaths } from "@/lib/photos/signedUrls";
import { PHOTO_UPLOAD_RETRY_ATTEMPTS } from "@/lib/forms/photoUploadErrors";
import { classifyStorageUploadError } from "@/lib/forms/storageUploadRetry";

export type IntakePhoto = {
  photo_id: string;
  work_order_id: string;
  uploaded_by_user_id: string | null;
  storage_path: string;
  thumb_storage_path: string | null;
  photo_url: string | null;
  category: PhotoCategory;
  notes: string | null;
  inspection_result_id: string | null;
  job_id: string | null;
  client_upload_id: string | null;
  content_type: string | null;
  byte_size: number | null;
  pixel_width: number | null;
  pixel_height: number | null;
  created_at: string;
  /** Full-size signed URL — lightbox and inspection zoom. */
  signed_url?: string | null;
  /** Compressed preview for boards, grids, and strips. */
  thumb_url?: string | null;
  uploaded_by?: {
    user_id: string;
    first_name: string;
    last_name: string;
  } | null;
};

const COLUMNS =
  "photo_id, work_order_id, uploaded_by_user_id, storage_path, thumb_storage_path, photo_url, category, notes, inspection_result_id, job_id, client_upload_id, content_type, byte_size, pixel_width, pixel_height, created_at";

const BUCKET = INTAKE_PHOTO_BUCKET;

export { signStoragePaths };
const MAX_BYTES = INTAKE_PHOTO_MAX_SOURCE_BYTES;
const ALLOWED_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);

function canUploadPhotos(role: AppUser["role"]) {
  return canEditWorkOrder(role) || canCreateWorkOrder(role) || isFloorTech(role);
}

async function requireMutableWorkOrder(
  user: AppUser,
  workOrderId: string
): Promise<{
  supabase: DbClient;
  locationId: string;
  workOrderNumber: string;
}> {
  const supabase = await createClient();
  const { data: workOrder, error } = await supabase
    .from("work_order")
    .select("work_order_id, location_id, work_order_number, status")
    .eq("work_order_id", workOrderId)
    .maybeSingle();

  if (error) throw error;
  if (!workOrder) throw new Error("WORK_ORDER_NOT_FOUND");
  assertViewerCanAccessWorkOrderLocation(user, workOrder.location_id);
  if (workOrder.status === "completed" || workOrder.status === "cancelled") {
    throw new Error("WORK_ORDER_LOCKED");
  }

  return {
    supabase,
    locationId: workOrder.location_id,
    workOrderNumber: workOrder.work_order_number,
  };
}

async function uploadIntakeBytes(
  supabase: DbClient,
  storagePath: string,
  bytes: Uint8Array,
  contentType: string
) {
  let lastError: {
    message?: string | null;
    statusCode?: string | number | null;
  } | null = null;
  for (let attempt = 0; attempt < PHOTO_UPLOAD_RETRY_ATTEMPTS; attempt += 1) {
    const { error } = await supabase.storage.from(BUCKET).upload(storagePath, bytes, {
      contentType,
      upsert: false,
    });
    const kind = classifyStorageUploadError(error);
    if (kind === "ok" || kind === "exists") return;
    lastError = error;
    if (kind === "fail" || attempt === PHOTO_UPLOAD_RETRY_ATTEMPTS - 1) break;
    await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt));
  }
  if (lastError) {
    const safeError = new Error("PHOTO_UPLOAD_FAILED") as Error & {
      statusCode?: string | number | null;
    };
    safeError.statusCode = lastError.statusCode;
    throw safeError;
  }
  throw new Error("PHOTO_UPLOAD_FAILED");
}

export type IntakePhotoRef = {
  photo_id: string;
  storage_path: string;
  thumb_storage_path?: string | null;
  photo_url?: string | null;
  category?: PhotoCategory | string | null;
  created_at?: string | null;
};

function previewPath(photo: {
  storage_path: string;
  thumb_storage_path?: string | null;
}): string {
  return photo.thumb_storage_path || photo.storage_path;
}

const PRIMARY_PHOTO_CATEGORY_RANK: Record<string, number> = {
  front: 0,
  left_side: 1,
  right_side: 2,
  rear: 3,
  damage: 4,
  accessories: 5,
  other: 6,
};

/** Prefer front, then other bike angles, then oldest remaining photo. */
export function pickPrimaryIntakePhoto<T extends IntakePhotoRef>(photos: T[]): T | null {
  if (photos.length === 0) return null;
  return [...photos].sort((a, b) => {
    const rankA =
      PRIMARY_PHOTO_CATEGORY_RANK[a.category ?? ""] ?? Number.MAX_SAFE_INTEGER;
    const rankB =
      PRIMARY_PHOTO_CATEGORY_RANK[b.category ?? ""] ?? Number.MAX_SAFE_INTEGER;
    if (rankA !== rankB) return rankA - rankB;
    return (a.created_at ?? "").localeCompare(b.created_at ?? "");
  })[0];
}

/** Sign one display URL per work order (front preferred). */
export async function resolvePrimaryPhotoUrls(
  supabase: DbClient,
  photosByWorkOrder: Map<string, IntakePhotoRef[]>
): Promise<Map<string, string | null>> {
  const primaryByWo = new Map<string, IntakePhotoRef>();
  const paths: string[] = [];

  for (const [workOrderId, photos] of photosByWorkOrder) {
    const primary = pickPrimaryIntakePhoto(photos);
    if (!primary) continue;
    primaryByWo.set(workOrderId, primary);
    paths.push(previewPath(primary));
  }

  const signed = await signStoragePaths(supabase, paths);
  const result = new Map<string, string | null>();

  for (const [workOrderId, primary] of primaryByWo) {
    result.set(
      workOrderId,
      signed.get(previewPath(primary)) ?? primary.photo_url ?? null
    );
  }
  return result;
}

type BoardPrimaryPhotoRow = {
  work_order_id: string;
  storage_path: string;
  thumb_storage_path: string | null;
  photo_url: string | null;
  category: string | null;
  photo_count: number | string;
};

/**
 * Lean board helper: one preferred photo path + count per WO via Postgres RPC
 * (avoids nesting every intake_photo on dashboard / control-center queries).
 */
export async function resolveBoardPrimaryPhotos(
  supabase: DbClient,
  workOrderIds: string[]
): Promise<{
  urls: Map<string, string | null>;
  counts: Map<string, number>;
}> {
  const urls = new Map<string, string | null>();
  const counts = new Map<string, number>();
  const uniqueIds = [...new Set(workOrderIds.filter(Boolean))];
  if (uniqueIds.length === 0) return { urls, counts };

  const { data, error } = await supabase.rpc("board_primary_intake_photos", {
    p_work_order_ids: uniqueIds,
  });

  if (error) throw error;

  const rows = (data ?? []) as BoardPrimaryPhotoRow[];
  const paths: string[] = [];
  for (const row of rows) {
    counts.set(row.work_order_id, Number(row.photo_count) || 0);
    const path = previewPath(row);
    if (path) paths.push(path);
  }

  const signed = await signStoragePaths(supabase, paths);
  for (const row of rows) {
    urls.set(row.work_order_id, signed.get(previewPath(row)) ?? row.photo_url ?? null);
  }

  for (const id of uniqueIds) {
    if (!counts.has(id)) counts.set(id, 0);
  }

  return { urls, counts };
}

async function signPaths(
  supabase: DbClient,
  photos: IntakePhoto[]
): Promise<IntakePhoto[]> {
  if (photos.length === 0) return photos;

  const byPath = await signStoragePaths(
    supabase,
    photos.flatMap((p) =>
      p.thumb_storage_path ? [p.storage_path, p.thumb_storage_path] : [p.storage_path]
    )
  );

  return photos.map((p) => {
    const signed_url = byPath.get(p.storage_path) ?? p.photo_url;
    return {
      ...p,
      signed_url,
      thumb_url:
        (p.thumb_storage_path ? byPath.get(p.thumb_storage_path) : null) ?? signed_url,
    };
  });
}

export async function listIntakePhotos(
  workOrderId: string,
  category?: PhotoCategory | null
): Promise<IntakePhoto[]> {
  await requireUser();
  const supabase = await createClient();

  let query = supabase
    .from("intake_photo")
    .select(
      `
      ${COLUMNS},
      uploaded_by:uploaded_by_user_id (
        user_id,
        first_name,
        last_name
      )
    `
    )
    .eq("work_order_id", workOrderId)
    .order("created_at", { ascending: false });

  if (category) {
    query = query.eq("category", category);
  }

  const { data, error } = await query;
  if (error) throw error;

  const photos = (data ?? []) as unknown as IntakePhoto[];
  return signPaths(supabase, photos);
}

export async function countIntakePhotos(workOrderId: string): Promise<number> {
  await requireUser();
  const supabase = await createClient();
  const { count, error } = await supabase
    .from("intake_photo")
    .select("photo_id", { count: "exact", head: true })
    .eq("work_order_id", workOrderId);

  if (error) throw error;
  return count ?? 0;
}

export async function uploadIntakePhoto(
  workOrderId: string,
  input: {
    category: PhotoCategory;
    notes?: string | null;
    inspection_result_id?: string | null;
    job_id?: string | null;
    client_upload_id?: string | null;
    file: File;
  }
): Promise<IntakePhoto> {
  const user = await requireUser();
  if (!canUploadPhotos(user.role)) throw new Error("FORBIDDEN");

  const parsed = intakePhotoSchema.parse({
    category: input.category,
    notes: input.notes,
    inspection_result_id: input.inspection_result_id,
    job_id: input.job_id,
    client_upload_id: input.client_upload_id,
  });

  if (parsed.category === "inspection_item" && !parsed.inspection_result_id) {
    throw new Error("INSPECTION_RESULT_NOT_FOUND");
  }

  // job_proof is the after photo that satisfies the completion gate;
  // job_work is the in-progress work journal and never counts as proof.
  // Both must be pinned to a job.
  if (
    (parsed.category === "job_proof" || parsed.category === "job_work") &&
    !parsed.job_id
  ) {
    throw new Error("JOB_NOT_FOUND");
  }

  const file = input.file;
  if (!file || file.size === 0) throw new Error("PHOTO_REQUIRED");
  if (file.size > MAX_BYTES) throw new Error("PHOTO_TOO_LARGE");
  if (file.type && !ALLOWED_TYPES.has(file.type)) {
    throw new Error("PHOTO_TYPE_INVALID");
  }

  const { supabase, locationId, workOrderNumber } = await requireMutableWorkOrder(
    user,
    workOrderId
  );

  if (parsed.job_id) {
    const { data: jobRow, error: jobError } = await supabase
      .from("job")
      .select("job_id, work_order_id, assigned_technician_id")
      .eq("job_id", parsed.job_id)
      .maybeSingle();
    if (jobError) throw jobError;
    if (!jobRow || jobRow.work_order_id !== workOrderId) {
      throw new Error("JOB_NOT_FOUND");
    }
    if (isFloorTech(user.role) && jobRow.assigned_technician_id !== user.user_id) {
      throw new Error("JOB_NOT_ASSIGNED_TO_YOU");
    }
  }

  if (parsed.inspection_result_id) {
    const { data: resultRow, error: resultError } = await supabase
      .from("inspection_result")
      .select(
        `
        inspection_result_id,
        inspection:inspection_id ( work_order_id )
      `
      )
      .eq("inspection_result_id", parsed.inspection_result_id)
      .maybeSingle();
    if (resultError) throw resultError;
    if (!resultRow) throw new Error("INSPECTION_RESULT_NOT_FOUND");
    const inspection = resultRow.inspection as unknown as {
      work_order_id: string;
    } | null;
    if (!inspection || inspection.work_order_id !== workOrderId) {
      throw new Error("INSPECTION_RESULT_NOT_FOUND");
    }
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.byteLength === 0) throw new Error("PHOTO_REQUIRED");

  const photo = await orchestrateIntakePhotoUpload(
    {
      workOrderId,
      uploadedByUserId: user.user_id,
      clientUploadId: parsed.client_upload_id ?? null,
      category: parsed.category,
      notes: parsed.notes ?? null,
      inspectionResultId: parsed.inspection_result_id ?? null,
      jobId: parsed.job_id ?? null,
      sourceBytes: bytes,
    },
    {
      createPhotoId: () => crypto.randomUUID(),
      findPhotoByClientUploadId: async (clientUploadId) => {
        const { data, error } = await supabase
          .from("intake_photo")
          .select(COLUMNS)
          .eq("client_upload_id", clientUploadId)
          .maybeSingle();
        if (error) throw error;
        return (data as IntakePhotoUploadRow | null) ?? null;
      },
      prepareCanonicalPhoto: canonicalizeIntakePhoto,
      makeThumbnail: makeCanonicalIntakeThumbnail,
      uploadObject: async (upload) => {
        await uploadIntakeBytes(supabase, upload.path, upload.bytes, upload.contentType);
      },
      removeObjects: async (paths) => {
        await supabase.storage.from(BUCKET).remove(paths);
      },
      insertPhoto: async (insert) => {
        const { data, error } = await supabase
          .from("intake_photo")
          .insert(insert)
          .select(COLUMNS)
          .single();
        if (error) throw error;
        return data as IntakePhotoUploadRow;
      },
      recordTimeline: async (savedPhoto) => {
        const categoryLabel =
          PHOTO_CATEGORY_LABELS[savedPhoto.category] ?? savedPhoto.category;
        await addTimelineEvent(supabase, {
          work_order_id: workOrderId,
          user_id: user.user_id,
          event_type: TimelineEventType.INTAKE_PHOTO_UPLOADED,
          entity_type: "intake_photo",
          entity_id: savedPhoto.photo_id,
          description: `Intake photo uploaded (${categoryLabel})`,
          new_value: {
            category: savedPhoto.category,
            storage_path: savedPhoto.storage_path,
          },
        });
      },
      recordAudit: async (savedPhoto) => {
        const categoryLabel =
          PHOTO_CATEGORY_LABELS[savedPhoto.category] ?? savedPhoto.category;
        await addAuditLog(supabase, {
          actor_user_id: user.user_id,
          location_id: locationId,
          action: "intake_photo_uploaded",
          entity_type: "intake_photo",
          entity_id: savedPhoto.photo_id,
          description: `Intake photo (${categoryLabel}) uploaded on ${workOrderNumber}`,
          new_value: {
            category: savedPhoto.category,
            storage_path: savedPhoto.storage_path,
          },
        });
      },
      logThumbnailFailure: (details) => {
        console.error("intake photo thumbnail failed", details);
      },
    }
  );

  const [signed] = await signPaths(supabase, [photo as IntakePhoto]);
  return signed;
}

/**
 * Owner/manager corrective delete — removes DB row and storage object.
 * Allowed even on completed work orders so bad intake media can be cleaned up.
 */
export async function deleteIntakePhoto(
  workOrderId: string,
  photoId: string
): Promise<void> {
  const user = await requireUser();
  if (!canDeleteIntakePhoto(user.role)) throw new Error("FORBIDDEN");

  const supabase = await createClient();
  const { data: workOrder, error: woError } = await supabase
    .from("work_order")
    .select("work_order_id, location_id, work_order_number, status")
    .eq("work_order_id", workOrderId)
    .maybeSingle();

  if (woError) throw woError;
  if (!workOrder) throw new Error("WORK_ORDER_NOT_FOUND");
  assertViewerCanAccessWorkOrderLocation(user, workOrder.location_id);

  const { data: photo, error: photoError } = await supabase
    .from("intake_photo")
    .select(COLUMNS)
    .eq("photo_id", photoId)
    .eq("work_order_id", workOrderId)
    .maybeSingle();

  if (photoError) throw photoError;
  if (!photo) throw new Error("PHOTO_NOT_FOUND");

  const row = photo as IntakePhoto;
  const { error: deleteError } = await supabase
    .from("intake_photo")
    .delete()
    .eq("photo_id", photoId)
    .eq("work_order_id", workOrderId);

  if (deleteError) throw new Error("PHOTO_DELETE_FAILED");

  const storagePaths = [row.storage_path];
  if (row.thumb_storage_path) storagePaths.push(row.thumb_storage_path);
  const { error: storageError } = await supabase.storage
    .from(BUCKET)
    .remove(storagePaths);
  if (storageError) {
    // Row is gone; storage orphan is preferable to failing the user action.
    console.error("intake photo storage remove failed", storageError);
  }

  const categoryLabel = PHOTO_CATEGORY_LABELS[row.category] ?? row.category;

  await addTimelineEvent(supabase, {
    work_order_id: workOrderId,
    user_id: user.user_id,
    event_type: TimelineEventType.INTAKE_PHOTO_DELETED,
    entity_type: "intake_photo",
    entity_id: photoId,
    description: `Intake photo removed (${categoryLabel})`,
    old_value: {
      category: row.category,
      storage_path: row.storage_path,
    },
  });

  await addAuditLog(supabase, {
    actor_user_id: user.user_id,
    location_id: workOrder.location_id,
    action: "intake_photo_deleted",
    entity_type: "intake_photo",
    entity_id: photoId,
    description: `Intake photo (${categoryLabel}) removed from ${workOrder.work_order_number}`,
    old_value: {
      category: row.category,
      storage_path: row.storage_path,
    },
  });
}
