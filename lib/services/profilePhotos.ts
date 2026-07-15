import { getCurrentAppUser } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/database/supabase-admin";
import { createClient } from "@/lib/database/supabase-server";
import {
  PROFILE_PHOTO_ALLOWED_TYPES,
  PROFILE_PHOTO_BUCKET,
  PROFILE_PHOTO_MAX_BYTES,
  profilePhotoExtension,
} from "@/lib/profilePhotos/storage";

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

export async function uploadOwnProfilePhoto(file: File): Promise<void> {
  const user = await getCurrentAppUser();
  if (!user) throw new Error("UNAUTHORIZED");
  validateProfilePhotoMetadata(file);

  const supabase = await createClient();
  const extension = profilePhotoExtension(file.type);
  const storagePath = `${user.user_id}/${crypto.randomUUID()}.${extension}`;
  const bytes = new Uint8Array(await file.arrayBuffer());

  const { error: uploadError } = await supabase.storage
    .from(PROFILE_PHOTO_BUCKET)
    .upload(storagePath, bytes, {
      contentType: file.type,
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
