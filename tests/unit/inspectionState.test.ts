import { describe, expect, it } from "vitest";
import { hasCompletedInspection } from "@/lib/technician/inspectionState";

describe("hasCompletedInspection", () => {
  it("handles Supabase to-one relation objects", () => {
    expect(hasCompletedInspection({ completed_at: "2026-07-15T15:24:15Z" })).toBe(true);
  });

  it("handles relation arrays and incomplete values", () => {
    expect(hasCompletedInspection([{ completed_at: "2026-07-15T15:24:15Z" }])).toBe(true);
    expect(hasCompletedInspection({ completed_at: null })).toBe(false);
    expect(hasCompletedInspection([])).toBe(false);
    expect(hasCompletedInspection(null)).toBe(false);
  });
});
