import { requireUser, type AppUser } from "@/lib/auth/session";
import { createClient } from "@/lib/database/supabase-server";
import type { DbClient, PhotoCategory } from "@/lib/database/types";
import { addAuditLog } from "@/lib/audit/addAuditLog";
import { addTimelineEvent } from "@/lib/timeline/addTimelineEvent";
import { TimelineEventType } from "@/lib/timeline/events";
import { canEditWorkOrder, canCreateWorkOrder } from "@/lib/permissions";
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
  return (
    canEditWorkOrder(role) ||
    canCreateWorkOrder(role) ||
    role === "technician"
  );
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
  if (
    workOrder.status === "completed" ||
    workOrder.status === "cancelled"
  ) {
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

async function signPaths(
  supabase: DbClient,
  photos: IntakePhoto[]
): Promise<IntakePhoto[]> {
  if (photos.length === 0) return photos;

  const paths = photos.map((p) => p.storage_path);
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrls(paths, 60 * 60);

  if (error || !data) {
    return photos.map((p) => ({ ...p, signed_url: p.photo_url }));
  }

  const byPath = new Map(
    data.map((row) => [row.path, row.signedUrl ?? null] as const)
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
    file: File;
  }
): Promise<IntakePhoto> {
  const user = await requireUser();
  if (!canUploadPhotos(user.role)) throw new Error("FORBIDDEN");

  const parsed = intakePhotoSchema.parse({
    category: input.category,
    notes: input.notes,
    inspection_result_id: input.inspection_result_id,
  });

  if (
    parsed.category === "inspection_item" &&
    !parsed.inspection_result_id
  ) {
    throw new Error("INSPECTION_RESULT_NOT_FOUND");
  }

  const file = input.file;
  if (!file || file.size === 0) throw new Error("PHOTO_REQUIRED");
  if (file.size > MAX_BYTES) throw new Error("PHOTO_TOO_LARGE");
  if (file.type && !ALLOWED_TYPES.has(file.type)) {
    throw new Error("PHOTO_TYPE_INVALID");
  }

  const { supabase, locationId, workOrderNumber } =
    await requireMutableWorkOrder(user, workOrderId);

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
    })
    .select(COLUMNS)
    .single();

  if (error) {
    await supabase.storage.from(BUCKET).remove([storagePath]);
    throw error;
  }

  const photo = data as IntakePhoto;
  const categoryLabel =
    PHOTO_CATEGORY_LABELS[photo.category] ?? photo.category;

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
