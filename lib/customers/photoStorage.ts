import type { DbClient } from "@/lib/database/types";
import { signBucketPaths } from "@/lib/photos/signedUrls";

export const CUSTOMER_PHOTO_BUCKET = "customer-photos";
/** After canonicalization to JPEG. The browser blocks larger originals first. */
export const CUSTOMER_PHOTO_MAX_BYTES = 5 * 1024 * 1024;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FILE_NAME = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$/;

/** One current portrait: `{customerId}/{photoId}.jpg`. */
export function customerPhotoStoragePath(customerId: string, photoId: string): string {
  if (!UUID.test(customerId) || !UUID.test(photoId)) {
    throw new Error("CUSTOMER_PHOTO_PATH_INVALID");
  }
  return `${customerId.toLowerCase()}/${photoId.toLowerCase()}.jpg`;
}

/** True when the path is a jpeg inside this customer's folder and nothing else. */
export function isOwnedCustomerPhotoPath(customerId: string, path: string): boolean {
  if (!UUID.test(customerId) || path.includes("..") || path.length > 300) return false;
  const prefix = `${customerId.toLowerCase()}/`;
  if (!path.startsWith(prefix)) return false;
  return FILE_NAME.test(path.slice(prefix.length));
}

export async function createCustomerPhotoSignedUrl(
  supabase: DbClient,
  storagePath: string | null,
  expiresInSeconds = 60 * 60
): Promise<string | null> {
  if (!storagePath) return null;
  const signed = await createCustomerPhotoSignedUrls(
    supabase,
    [storagePath],
    expiresInSeconds
  );
  return signed.get(storagePath) ?? null;
}

export async function createCustomerPhotoSignedUrls(
  supabase: DbClient,
  storagePaths: Array<string | null>,
  expiresInSeconds = 60 * 60
): Promise<Map<string, string | null>> {
  return signBucketPaths(
    supabase,
    CUSTOMER_PHOTO_BUCKET,
    storagePaths.filter((path): path is string => Boolean(path)),
    expiresInSeconds
  );
}
