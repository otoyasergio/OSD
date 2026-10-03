import { getCurrentAppUser } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/database/supabase-admin";
import { createClient } from "@/lib/database/supabase-server";
import {
  PROFILE_PHOTO_ALLOWED_TYPES,
  PROFILE_PHOTO_BUCKET,
  PROFILE_PHOTO_MAX_BYTES,
} from "@/lib/profilePhotos/storage";
import { canonicalizeUploadedFile } from "@/lib/photos/canonicalizeUploadedFile";

type ProfilePhotoMetadata = {
  size: number;
  type: string;
};

/** Pure validation used by the service and unit tests. */
export function validateProfilePhotoMetadata(file: ProfilePhotoMetadata): void {
  if (!file || file.size <= 0) throw new Error("PROFILE_PHOTO_REQUIRED");
  if (file.size > PROFILE_PHOTO_MAX_BYTES) {
    throw new Error("PROFILE_PHOTO_TOO_LARGE");
  }
  if (!PROFILE_PHOTO_ALLOWED_TYPES.has(file.type)) {
    throw new Error("PROFILE_PHOTO_TYPE_INVALID");
  }
}

async function updateProfilePhotoPath(
  userId: string,
  storagePath: string | null
): Promise<void> {
  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch {
    throw new Error("PROFILE_PHOTO_UPDATE_FAILED");
  }

  const { error } = await admin
    .from("app_user")
    .update({
      profile_photo_path: storagePath,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId);
  if (error) throw new Error("PROFILE_PHOTO_UPDATE_FAILED");
}

function mapProfileCanonicalError(error: unknown): never {
  const code = error instanceof Error ? error.message : "";
  if (code === "REQUIRED") throw new Error("PROFILE_PHOTO_REQUIRED");
  if (code === "TOO_LARGE") throw new Error("PROFILE_PHOTO_TOO_LARGE");
  if (code === "TYPE_INVALID") throw new Error("PROFILE_PHOTO_TYPE_INVALID");
  throw error instanceof Error ? error : new Error("PROFILE_PHOTO_TYPE_INVALID");
}

export async function uploadOwnProfilePhoto(file: File): Promise<void> {
  const user = await getCurrentAppUser();
  if (!user) throw new Error("UNAUTHORIZED");
  if (!(file instanceof File)) throw new Error("PROFILE_PHOTO_REQUIRED");

  let canonical;
  try {
    canonical = await canonicalizeUploadedFile({
      bytes: new Uint8Array(await file.arrayBuffer()),
      declaredType: file.type,
      maxBytes: PROFILE_PHOTO_MAX_BYTES,
      allowPdf: false,
    });
  } catch (error) {
    mapProfileCanonicalError(error);
  }

  const supabase = await createClient();
  const storagePath = `${user.user_id}/${crypto.randomUUID()}.${canonical.extension}`;

  const { error: uploadError } = await supabase.storage
    .from(PROFILE_PHOTO_BUCKET)
    .upload(storagePath, canonical.bytes, {
      contentType: canonical.contentType,
      upsert: false,
    });
  if (uploadError) throw new Error("PROFILE_PHOTO_UPLOAD_FAILED");

  try {
    await updateProfilePhotoPath(user.user_id, storagePath);
  } catch {
    await supabase.storage.from(PROFILE_PHOTO_BUCKET).remove([storagePath]);
    throw new Error("PROFILE_PHOTO_UPDATE_FAILED");
  }

  if (user.profile_photo_path && user.profile_photo_path !== storagePath) {
    await supabase.storage.from(PROFILE_PHOTO_BUCKET).remove([user.profile_photo_path]);
  }
}

export async function removeOwnProfilePhoto(): Promise<void> {
  const user = await getCurrentAppUser();
  if (!user) throw new Error("UNAUTHORIZED");

  await updateProfilePhotoPath(user.user_id, null);
  if (user.profile_photo_path) {
    const supabase = await createClient();
    await supabase.storage.from(PROFILE_PHOTO_BUCKET).remove([user.profile_photo_path]);
  }
}
