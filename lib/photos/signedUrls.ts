import type { DbClient } from "@/lib/database/types";

export const INTAKE_PHOTO_BUCKET = "intake-photos";

const DEFAULT_SIGN_TTL_SECONDS = 60 * 60;
/** Reuse a signed URL for 45 min of its 60 min validity. */
const SIGNED_URL_REUSE_MS = 45 * 60 * 1000;
const SIGNED_URL_CACHE_MAX = 4000;

/**
 * Per-instance cache of signed URLs. Without it every server render mints a
 * new token per photo, so the URL changes and the browser re-downloads every
 * thumbnail on every refresh. A stable URL lets the browser cache do its job.
 * Signed URLs are bearer links to staff photos either way; all callers are
 * staff/portal surfaces already authorized to view them.
 */
const signedUrlCache = new Map<string, { url: string; freshUntil: number }>();

function pruneSignedUrlCache(now: number): void {
  if (signedUrlCache.size <= SIGNED_URL_CACHE_MAX) return;
  for (const [key, value] of signedUrlCache) {
    if (value.freshUntil <= now) signedUrlCache.delete(key);
  }
  if (signedUrlCache.size <= SIGNED_URL_CACHE_MAX) return;
  // Still over cap: drop oldest half by insertion order.
  let toDrop = Math.ceil(signedUrlCache.size / 2);
  for (const key of signedUrlCache.keys()) {
    if (toDrop-- <= 0) break;
    signedUrlCache.delete(key);
  }
}

export async function signStoragePaths(
  supabase: DbClient,
  paths: string[],
  expiresInSeconds = DEFAULT_SIGN_TTL_SECONDS
): Promise<Map<string, string | null>> {
  const unique = [...new Set(paths.filter(Boolean))];
  const byPath = new Map<string, string | null>();
  if (unique.length === 0) return byPath;

  // Only the default TTL flows through the cache; custom expiries (e.g.
  // portal links) always sign fresh.
  const cacheable = expiresInSeconds === DEFAULT_SIGN_TTL_SECONDS;
  const now = Date.now();
  const misses: string[] = [];
  if (cacheable) {
    for (const path of unique) {
      const hit = signedUrlCache.get(path);
      if (hit && hit.freshUntil > now) byPath.set(path, hit.url);
      else misses.push(path);
    }
    if (misses.length === 0) return byPath;
  } else {
    misses.push(...unique);
  }

  const { data, error } = await supabase.storage
    .from(INTAKE_PHOTO_BUCKET)
    .createSignedUrls(misses, expiresInSeconds);

  if (error || !data) {
    for (const path of misses) byPath.set(path, null);
    return byPath;
  }

  for (const row of data) {
    if (!row.path) continue;
    const url = row.signedUrl ?? null;
    byPath.set(row.path, url);
    if (cacheable && url) {
      signedUrlCache.set(row.path, { url, freshUntil: now + SIGNED_URL_REUSE_MS });
    }
  }
  if (cacheable) pruneSignedUrlCache(now);
  return byPath;
}
