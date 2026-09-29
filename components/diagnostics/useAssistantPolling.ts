"use client";

import { useEffect, useEffectEvent, useState } from "react";
import { ASSISTANT_POLL, nextAssistantPollDelay } from "@/lib/diagnostics/askOtomotoView";

/**
 * Refreshes server data on a backoff while the assistant is working. One timer
 * at a time; stops when inactive, on unmount, or after the timeout. Only time
 * the tab is visible counts toward the timeout: a hidden tab pauses the
 * schedule and a visible one resumes the remaining interval. `resetKey`
 * restarts the schedule when the thread moves to a new working state.
 */
export function useAssistantPolling(
  active: boolean,
  resetKey: string,
  refresh: () => void
): { timedOut: boolean } {
  const [timedOutKey, setTimedOutKey] = useState<string | null>(null);
  const onTick = useEffectEvent(() => refresh());

  useEffect(() => {
    if (!active) return;
    let attempt = 0;
    let visibleElapsed = 0;
    let remaining = nextAssistantPollDelay(0);
    let startedAt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let finished = false;

    const stopTimer = () => {
      if (timer === undefined) return;
      clearTimeout(timer);
      timer = undefined;
    };
    const run = () => {
      startedAt = Date.now();
      timer = setTimeout(() => {
        timer = undefined;
        visibleElapsed += remaining;
        attempt += 1;
        onTick();
        if (visibleElapsed >= ASSISTANT_POLL.timeoutMs) {
          finished = true;
          setTimedOutKey(resetKey);
          return;
        }
        remaining = nextAssistantPollDelay(attempt);
        run();
      }, remaining);
    };
    const onVisibilityChange = () => {
      if (finished) return;
      if (document.visibilityState === "hidden") {
        if (timer === undefined) return;
        const spent = Math.min(Date.now() - startedAt, remaining);
        visibleElapsed += spent;
        remaining -= spent;
        stopTimer();
      } else if (timer === undefined) {
        run();
      }
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    if (document.visibilityState !== "hidden") run();
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      stopTimer();
    };
  }, [active, resetKey]);

  return { timedOut: active && timedOutKey === resetKey };
}
