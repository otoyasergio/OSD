import { describe, it, expect } from "vitest";
import {
  getInspectionTimerState,
  INSPECTION_TARGET_MS,
} from "@/lib/inspections/inspectionTimer";

describe("getInspectionTimerState", () => {
  const started = "2026-07-14T12:00:00.000Z";

  it("counts down within the first 20 minutes", () => {
    const now = Date.parse(started) + 5 * 60 * 1000;
    const state = getInspectionTimerState(started, now);
    expect(state.mode).toBe("countdown");
    expect(state.display).toBe("15:00");
    expect(state.remainingMs).toBe(15 * 60 * 1000);
  });

  it("switches to overtime after 20 minutes", () => {
    const now = Date.parse(started) + INSPECTION_TARGET_MS + 90 * 1000;
    const state = getInspectionTimerState(started, now);
    expect(state.mode).toBe("overtime");
    expect(state.display).toBe("+01:30");
    expect(state.overtimeMs).toBe(90 * 1000);
  });
});
