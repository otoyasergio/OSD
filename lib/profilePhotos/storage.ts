import type { DbClient } from "@/lib/database/types";
import { signBucketPaths } from "@/lib/photos/signedUrls";

export const PROFILE_PHOTO_BUCKET = "profile-photos";
export const PROFILE_PHOTO_MAX_BYTES = 5 * 1024 * 1024;
export const PROFILE_PHOTO_ALLOWED_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export function profilePhotoExtension(contentType: string): "jpg" | "png" | "webp" {
  if (contentType === "image/png") return "png";
  if (contentType === "image/webp") return "webp";
  return "jpg";
}

export async function createProfilePhotoSignedUrl(
  supabase: DbClient,
  storagePath: string | null,
  expiresInSeconds = 60 * 60
): Promise<string | null> {
  if (!storagePath) return null;
  const signed = await signBucketPaths(
    supabase,
    PROFILE_PHOTO_BUCKET,
    [storagePath],
    expiresInSeconds
  );
  return signed.get(storagePath) ?? null;
}

export async function createProfilePhotoSignedUrls(
  supabase: DbClient,
  storagePaths: Array<string | null>,
  expiresInSeconds = 60 * 60
): Promise<Map<string, string | null>> {
  return signBucketPaths(
    supabase,
    PROFILE_PHOTO_BUCKET,
    storagePaths.filter((path): path is string => Boolean(path)),
    expiresInSeconds
  );
}
