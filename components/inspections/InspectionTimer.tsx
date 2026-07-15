"use client";

import { useEffect, useState } from "react";
import { getInspectionTimerState } from "@/lib/inspections/inspectionTimer";

/**
 * Sticky 20-minute countdown from started_at; overtime count-up with warning.
 * Wall-clock only — leaving and returning continues the same clock.
 */
export function InspectionTimer({ startedAt }: { startedAt: string }) {
  const [now, setNow] = useState(() => Date.now());
  const [announcedOvertime, setAnnouncedOvertime] = useState(false);

  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const id = window.setInterval(tick, 1000);
    const onVisibility = () => {
      if (document.visibilityState === "visible") tick();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [startedAt]);

  const state = getInspectionTimerState(startedAt, now);

  useEffect(() => {
    if (state.mode === "overtime" && !announcedOvertime) {
      setAnnouncedOvertime(true);
    }
  }, [state.mode, announcedOvertime]);

  return (
    <div
      className={`inspection-timer ${
        state.mode === "overtime" ? "inspection-timer--overtime" : ""
      }`}
      role="status"
      aria-live="polite"
    >
      <span className="inspection-timer-label">
        {state.mode === "countdown" ? "Time remaining" : "Over time for this inspection"}
      </span>
      <span className="inspection-timer-value" aria-atomic="true">
        {state.display}
      </span>
    </div>
  );
}
