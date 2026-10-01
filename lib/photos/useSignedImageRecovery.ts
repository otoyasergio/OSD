"use client";

import { useCallback, type SyntheticEvent } from "react";
import { useRouter } from "next/navigation";

const recoveredSignedUrls = new Set<string>();

export function resetSignedImageRecovery(): void {
  recoveredSignedUrls.clear();
}

export function isSupabaseSignedObjectUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return false;
    if (!parsed.hostname.endsWith(".supabase.co")) return false;
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
      if (recoveredSignedUrls.has(src)) return;
      recoveredSignedUrls.add(src);
      router.refresh();
    },
    [onError, router, src]
  );
}
