"use client";

import { useCallback, type SyntheticEvent } from "react";
import { useRouter } from "next/navigation";

export const SIGNED_IMAGE_RECOVERY_MAX = 256;

const recoveredSignedUrls = new Set<string>();
let recoveredMax = SIGNED_IMAGE_RECOVERY_MAX;
let refreshBurstScheduled = false;
let scheduledRefresh: (() => void) | null = null;

export function resetSignedImageRecovery(options?: { max?: number }): void {
  recoveredSignedUrls.clear();
  recoveredMax = options?.max ?? SIGNED_IMAGE_RECOVERY_MAX;
  refreshBurstScheduled = false;
  scheduledRefresh = null;
}

function rememberRecoveredSignedUrl(url: string): boolean {
  if (recoveredSignedUrls.has(url)) return false;
  recoveredSignedUrls.add(url);
  while (recoveredSignedUrls.size > recoveredMax) {
    const oldest = recoveredSignedUrls.values().next().value;
    if (oldest === undefined) break;
    recoveredSignedUrls.delete(oldest);
  }
  return true;
}

function scheduleSignedImageRefresh(refresh: () => void): void {
  scheduledRefresh = refresh;
  if (refreshBurstScheduled) return;
  refreshBurstScheduled = true;
  queueMicrotask(() => {
    const run = scheduledRefresh;
    refreshBurstScheduled = false;
    scheduledRefresh = null;
    run?.();
  });
}

function configuredSupabaseHostname(): string | null {
  const raw = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  if (!raw) return null;
  try {
    return new URL(raw).hostname;
  } catch {
    return null;
  }
}

export function isSupabaseSignedObjectUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;
    const hosted =
      parsed.protocol === "https:" && parsed.hostname.endsWith(".supabase.co");
    const configured = configuredSupabaseHostname();
    const exactConfigured = configured != null && parsed.hostname === configured;
    if (!hosted && !exactConfigured) return false;
    return parsed.pathname.includes("/storage/v1/object/sign/");
  } catch {
    return false;
  }
}

export type SignedImageErrorHandler = (event: SyntheticEvent<HTMLImageElement>) => void;

export function useSignedImageRecovery(
  src: string | null | undefined,
  onError?: SignedImageErrorHandler
): SignedImageErrorHandler {
  const router = useRouter();

  return useCallback(
    (event: SyntheticEvent<HTMLImageElement>) => {
      onError?.(event);
      if (!src || !isSupabaseSignedObjectUrl(src)) return;
      if (!rememberRecoveredSignedUrl(src)) return;
      scheduleSignedImageRefresh(() => router.refresh());
    },
    [onError, router, src]
  );
}
