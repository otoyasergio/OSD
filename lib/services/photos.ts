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
import { PHOTO_CATEGORY_LABELS } from "@/lib/status/labels";

export type IntakePhoto = {
  photo_id: string;
  work_order_id: string;
  uploaded_by_user_id: string | null;
  storage_path: string;
  photo_url: string | null;
  category: PhotoCategory;
  notes: string | null;
  inspection_result_id: string | null;
  created_at: string;
  signed_url?: string | null;
  uploaded_by?: {
    user_id: string;
    first_name: string;
    last_name: string;
  } | null;
};

const COLUMNS =
  "photo_id, work_order_id, uploaded_by_user_id, storage_path, photo_url, category, notes, inspection_result_id, created_at";

const BUCKET = "intake-photos";
const MAX_BYTES = 10 * 1024 * 1024;
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
  if (workOrder.location_id !== user.active_location_id) {
    throw new Error("FOREIGN_LOCATION");
  }
  if (workOrder.status === "completed" || workOrder.status === "cancelled") {
    throw new Error("WORK_ORDER_LOCKED");
  }

  return {
    supabase,
    locationId: workOrder.location_id,
    workOrderNumber: workOrder.work_order_number,
  };
}

function extensionForType(type: string): string {
  if (type === "image/png") return "png";
  if (type === "image/webp") return "webp";
  if (type === "image/heic" || type === "image/heif") return "heic";
  return "jpg";
}

export type IntakePhotoRef = {
  photo_id: string;
  storage_path: string;
  photo_url?: string | null;
  category?: PhotoCategory | string | null;
  created_at?: string | null;
};

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

export async function signStoragePaths(
  supabase: DbClient,
  paths: string[],
  expiresInSeconds = 60 * 60
): Promise<Map<string, string | null>> {
  const unique = [...new Set(paths.filter(Boolean))];
  const byPath = new Map<string, string | null>();
  if (unique.length === 0) return byPath;

  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrls(unique, expiresInSeconds);

  if (error || !data) {
    for (const path of unique) byPath.set(path, null);
    return byPath;
  }

  for (const row of data) {
    if (row.path) byPath.set(row.path, row.signedUrl ?? null);
  }
  return byPath;
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
    paths.push(primary.storage_path);
  }

  const signed = await signStoragePaths(supabase, paths);
  const result = new Map<string, string | null>();

  for (const [workOrderId, primary] of primaryByWo) {
    result.set(
      workOrderId,
      signed.get(primary.storage_path) ?? primary.photo_url ?? null
    );
  }
  return result;
}

async function signPaths(
  supabase: DbClient,
  photos: IntakePhoto[]
): Promise<IntakePhoto[]> {
  if (photos.length === 0) return photos;

  const byPath = await signStoragePaths(
    supabase,
    photos.map((p) => p.storage_path)
  );

  return photos.map((p) => ({
    ...p,
    signed_url: byPath.get(p.storage_path) ?? p.photo_url,
  }));
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
  });

  if (parsed.category === "inspection_item" && !parsed.inspection_result_id) {
    throw new Error("INSPECTION_RESULT_NOT_FOUND");
  }

  if (parsed.category === "job_proof" && !parsed.job_id) {
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

  const ext = extensionForType(file.type || "image/jpeg");
  const photoId = crypto.randomUUID();
  const storagePath = `${workOrderId}/${parsed.category}/${photoId}.${ext}`;

  const bytes = new Uint8Array(await file.arrayBuffer());
  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, bytes, {
      contentType: file.type || "image/jpeg",
      upsert: false,
    });

  if (uploadError) throw new Error("PHOTO_UPLOAD_FAILED");

  const { data, error } = await supabase
    .from("intake_photo")
    .insert({
      photo_id: photoId,
      work_order_id: workOrderId,
      uploaded_by_user_id: user.user_id,
      storage_path: storagePath,
      photo_url: null,
      category: parsed.category,
      notes: parsed.notes ?? null,
      inspection_result_id: parsed.inspection_result_id ?? null,
      job_id: parsed.job_id ?? null,
    })
    .select(COLUMNS)
    .single();

  if (error) {
    await supabase.storage.from(BUCKET).remove([storagePath]);
    throw error;
  }

  const photo = data as IntakePhoto;
  const categoryLabel = PHOTO_CATEGORY_LABELS[photo.category] ?? photo.category;

  await addTimelineEvent(supabase, {
    work_order_id: workOrderId,
    user_id: user.user_id,
    event_type: TimelineEventType.INTAKE_PHOTO_UPLOADED,
    entity_type: "intake_photo",
    entity_id: photo.photo_id,
    description: `Intake photo uploaded (${categoryLabel})`,
    new_value: { category: photo.category, storage_path: storagePath },
  });

  await addAuditLog(supabase, {
    actor_user_id: user.user_id,
    location_id: locationId,
    action: "intake_photo_uploaded",
    entity_type: "intake_photo",
    entity_id: photo.photo_id,
    description: `Intake photo (${categoryLabel}) uploaded on ${workOrderNumber}`,
    new_value: {
      category: photo.category,
      storage_path: storagePath,
    },
  });

  const [signed] = await signPaths(supabase, [photo]);
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
  if (workOrder.location_id !== user.active_location_id) {
    throw new Error("FOREIGN_LOCATION");
  }

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

  const { error: storageError } = await supabase.storage
    .from(BUCKET)
    .remove([row.storage_path]);
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
