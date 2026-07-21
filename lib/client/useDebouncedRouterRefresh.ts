"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef } from "react";

type Options = {
  /** Coalesce window in ms. */
  delayMs?: number;
  /** When true, events queue but do not flush until unpaused. */
  isPaused?: () => boolean;
};

/**
 * Coalesces bursty `router.refresh()` calls (Realtime, multi-action success).
 * Pending refreshes flush after `delayMs` once `isPaused` returns false.
 */
export function useDebouncedRouterRefresh(options: Options = {}) {
  const { delayMs = 1500, isPaused } = options;
  const router = useRouter();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef(false);
  const isPausedRef = useRef(isPaused);
  const delayMsRef = useRef(delayMs);
  const flushRef = useRef<() => void>(() => {});

  useEffect(() => {
    isPausedRef.current = isPaused;
  }, [isPaused]);

  useEffect(() => {
    delayMsRef.current = delayMs;
  }, [delayMs]);

  const flush = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (!pendingRef.current) return;
    if (isPausedRef.current?.()) {
      timerRef.current = setTimeout(() => {
        flushRef.current();
      }, delayMsRef.current);
      return;
    }
    pendingRef.current = false;
    router.refresh();
  }, [router]);

  useEffect(() => {
    flushRef.current = flush;
  }, [flush]);

  const schedule = useCallback(() => {
    pendingRef.current = true;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      flushRef.current();
    }, delayMsRef.current);
  }, []);

  /** Drop a queued refresh without calling `router.refresh()` (e.g. before an optimistic write). */
  const cancel = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    pendingRef.current = false;
  }, []);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return { schedule, flush, cancel };
}
