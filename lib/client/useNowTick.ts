"use client";

import { useSyncExternalStore } from "react";

/**
 * 1s wall-clock tick for live elapsed timers.
 * Server/disabled snapshot is 0 (avoids hydration mismatch).
 * Client snapshot is quantized to the second so getSnapshot is stable
 * between interval ticks (raw Date.now() would loop renders).
 */
const subscribe = (onStoreChange: () => void) => {
  const id = window.setInterval(onStoreChange, 1000);
  return () => window.clearInterval(id);
};

const noopSubscribe = () => () => {};

const getSnapshot = () => Math.floor(Date.now() / 1000) * 1000;

const getServerSnapshot = () => 0;

export function useNowTick(enabled: boolean): number {
  return useSyncExternalStore(
    enabled ? subscribe : noopSubscribe,
    enabled ? getSnapshot : getServerSnapshot,
    getServerSnapshot
  );
}
