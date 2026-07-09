import { describe, expect, it } from "vitest";
import { buildWorkOrderFlags, isOverdue } from "@/lib/status/flags";

describe("buildWorkOrderFlags", () => {
  it("includes safety-critical and overdue flags", () => {
    const flags = buildWorkOrderFlags({
      status: "in_progress",
      vin: null,
      external_invoice_number: null,
      estimated_completion: "2020-01-01T00:00:00.000Z",
      jobs: [{ status: "waiting_for_approval" }],
      recommendations: [{ severity: "safety_critical", status: "pending" }],
      photoCount: 0,
      inspectionComplete: false,
      now: new Date("2026-07-08T00:00:00.000Z"),
    });

    expect(flags).toEqual([
      "Missing VIN",
      "Missing invoice #",
      "No intake photos",
      "Incomplete inspection",
      "Needs approval",
      "Safety-critical",
      "Overdue",
    ]);
  });

  it("does not mark completed work orders overdue", () => {
    expect(
      isOverdue("2020-01-01T00:00:00.000Z", "completed", new Date())
    ).toBe(false);
  });
});
