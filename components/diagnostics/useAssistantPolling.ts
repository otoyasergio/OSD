"use client";

import { useEffect, useEffectEvent, useState } from "react";
import { ASSISTANT_POLL, nextAssistantPollDelay } from "@/lib/diagnostics/askOtomotoView";

/**
 * Refreshes server data on a backoff while the assistant is working. One timer
 * at a time; stops when inactive, on unmount, or after the timeout. `resetKey`
 * restarts the schedule when the thread moves to a new working state.
 */
export function useAssistantPolling(
  active: boolean,
  resetKey: string,
  refresh: () => void
): { timedOut: boolean } {
  const [timedOutKey, setTimedOutKey] = useState<string | null>(null);
  const onTick = useEffectEvent(() => {
    if (document.visibilityState !== "hidden") refresh();
  });

  useEffect(() => {
    if (!active) return;
    let attempt = 0;
    let elapsed = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      if (elapsed >= ASSISTANT_POLL.timeoutMs) {
        setTimedOutKey(resetKey);
        return;
      }
      const delay = nextAssistantPollDelay(attempt);
      timer = setTimeout(() => {
        elapsed += delay;
        attempt += 1;
        onTick();
        schedule();
      }, delay);
    };
    schedule();
    return () => {
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [active, resetKey]);

  return { timedOut: active && timedOutKey === resetKey };
}
