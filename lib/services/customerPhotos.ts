import { requireUser } from "@/lib/auth/session";
import { addAuditLog } from "@/lib/audit/addAuditLog";
import { createClient } from "@/lib/database/supabase-server";
import {
  CUSTOMER_PHOTO_BUCKET,
  CUSTOMER_PHOTO_MAX_BYTES,
  createCustomerPhotoSignedUrl,
  createCustomerPhotoSignedUrls,
  customerPhotoStoragePath,
  isOwnedCustomerPhotoPath,
} from "@/lib/customers/photoStorage";
import { canManageCustomerPhotos } from "@/lib/permissions";
import { canonicalizeUploadedFile } from "@/lib/photos/canonicalizeUploadedFile";
import { getCustomerById } from "@/lib/services/customers";

function mapCustomerPhotoError(error: unknown): never {
  const code = error instanceof Error ? error.message : "";
  if (code === "REQUIRED") throw new Error("CUSTOMER_PHOTO_REQUIRED");
  if (code === "TOO_LARGE") throw new Error("CUSTOMER_PHOTO_TOO_LARGE");
  if (code === "TYPE_INVALID") throw new Error("CUSTOMER_PHOTO_TYPE_INVALID");
  throw error instanceof Error ? error : new Error("CUSTOMER_PHOTO_TYPE_INVALID");
}

async function removeStoredPhoto(
  supabase: Awaited<ReturnType<typeof createClient>>,
  storagePath: string | null
): Promise<void> {
  if (!storagePath) return;
  await supabase.storage.from(CUSTOMER_PHOTO_BUCKET).remove([storagePath]);
}

export async function uploadCustomerPhoto(customerId: string, file: File): Promise<void> {
  const user = await requireUser();
  if (!canManageCustomerPhotos(user.role)) throw new Error("FORBIDDEN");
  if (!(file instanceof File)) throw new Error("CUSTOMER_PHOTO_REQUIRED");

  const customer = await getCustomerById(customerId);
  if (!customer) throw new Error("CUSTOMER_NOT_FOUND");

  let canonical;
  try {
    canonical = await canonicalizeUploadedFile({
      bytes: new Uint8Array(await file.arrayBuffer()),
      declaredType: file.type,
      maxBytes: CUSTOMER_PHOTO_MAX_BYTES,
      allowPdf: false,
    });
  } catch (error) {
    mapCustomerPhotoError(error);
  }

  const storagePath = customerPhotoStoragePath(customerId, crypto.randomUUID());
  const supabase = await createClient();
  const { error: uploadError } = await supabase.storage
    .from(CUSTOMER_PHOTO_BUCKET)
    .upload(storagePath, canonical.bytes, {
      contentType: canonical.contentType,
      upsert: false,
    });
  if (uploadError) throw new Error("CUSTOMER_PHOTO_UPLOAD_FAILED");

  const { data: updated, error: updateError } = await supabase
    .from("customer")
    .update({
      photo_path: storagePath,
      updated_at: new Date().toISOString(),
    })
    .eq("customer_id", customerId)
    .select("customer_id")
    .maybeSingle();

  if (updateError || !updated) {
    await removeStoredPhoto(supabase, storagePath);
    throw new Error("CUSTOMER_PHOTO_UPDATE_FAILED");
  }

  if (
    customer.photo_path &&
    customer.photo_path !== storagePath &&
    isOwnedCustomerPhotoPath(customerId, customer.photo_path)
  ) {
    await removeStoredPhoto(supabase, customer.photo_path);
  }

  await addAuditLog(supabase, {
    actor_user_id: user.user_id,
    location_id: user.active_location_id,
    action: "customer_photo_updated",
    entity_type: "customer",
    entity_id: customerId,
    description: `Updated photo for ${customer.first_name} ${customer.last_name}`,
    new_value: { photo_path: storagePath },
  });
}

export async function removeCustomerPhoto(customerId: string): Promise<void> {
  const user = await requireUser();
  if (!canManageCustomerPhotos(user.role)) throw new Error("FORBIDDEN");

  const customer = await getCustomerById(customerId);
  if (!customer) throw new Error("CUSTOMER_NOT_FOUND");
  if (!customer.photo_path) return;

  const supabase = await createClient();
  const { data: updated, error: updateError } = await supabase
    .from("customer")
    .update({
      photo_path: null,
      updated_at: new Date().toISOString(),
    })
    .eq("customer_id", customerId)
    .select("customer_id")
    .maybeSingle();

  if (updateError || !updated) throw new Error("CUSTOMER_PHOTO_UPDATE_FAILED");

  if (isOwnedCustomerPhotoPath(customerId, customer.photo_path)) {
    await removeStoredPhoto(supabase, customer.photo_path);
  }

  await addAuditLog(supabase, {
    actor_user_id: user.user_id,
    location_id: user.active_location_id,
    action: "customer_photo_removed",
    entity_type: "customer",
    entity_id: customerId,
    description: `Removed photo for ${customer.first_name} ${customer.last_name}`,
    old_value: { photo_path: customer.photo_path },
    new_value: { photo_path: null },
  });
}

export async function signCustomerPhotoForViewer(
  storagePath: string | null
): Promise<string | null> {
  const user = await requireUser();
  if (!canManageCustomerPhotos(user.role) || !storagePath) return null;
  const supabase = await createClient();
  return createCustomerPhotoSignedUrl(supabase, storagePath);
}

export async function signCustomerPhotosForViewer(
  storagePaths: Array<string | null>
): Promise<Map<string, string | null>> {
  const user = await requireUser();
  if (!canManageCustomerPhotos(user.role)) return new Map();
  const supabase = await createClient();
  return createCustomerPhotoSignedUrls(supabase, storagePaths);
}
