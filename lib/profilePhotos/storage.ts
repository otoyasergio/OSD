import type { DbClient } from "@/lib/database/types";

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
  const { data, error } = await supabase.storage
    .from(PROFILE_PHOTO_BUCKET)
    .createSignedUrl(storagePath, expiresInSeconds);
  return error ? null : (data?.signedUrl ?? null);
}

export async function createProfilePhotoSignedUrls(
  supabase: DbClient,
  storagePaths: Array<string | null>,
  expiresInSeconds = 60 * 60
): Promise<Map<string, string | null>> {
  const paths = [
    ...new Set(storagePaths.filter((path): path is string => Boolean(path))),
  ];
  const byPath = new Map<string, string | null>();
  if (paths.length === 0) return byPath;

  const { data, error } = await supabase.storage
    .from(PROFILE_PHOTO_BUCKET)
    .createSignedUrls(paths, expiresInSeconds);
  if (error || !data) {
    paths.forEach((path) => byPath.set(path, null));
    return byPath;
  }

  data.forEach((row) => {
    if (row.path) byPath.set(row.path, row.signedUrl ?? null);
  });
  return byPath;
}
