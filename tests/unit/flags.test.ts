import { describe, expect, it } from "vitest";
import { buildWorkOrderFlags, isOverdue } from "@/lib/status/flags";

describe("buildWorkOrderFlags", () => {
  it("includes safety-critical and overdue flags", () => {
    const flags = buildWorkOrderFlags({
      status: "in_progress",
      vin: null,
      estimated_completion: "2020-01-01T00:00:00.000Z",
      jobs: [{ status: "waiting_for_approval" }],
      recommendations: [{ severity: "safety_critical", status: "pending" }],
      photoCount: 0,
      inspectionComplete: false,
      now: new Date("2026-07-08T00:00:00.000Z"),
    });

    expect(flags).toEqual([
      "Missing VIN",
      "No intake photos",
      "Incomplete inspection",
      "Needs approval",
      "Safety-critical",
      "Overdue",
    ]);
  });

  it("includes Contract unsigned when agreement is missing", () => {
    const flags = buildWorkOrderFlags({
      status: "open",
      vin: "ABC",
      estimated_completion: null,
      jobs: [],
      recommendations: [],
      photoCount: 2,
      hasSignedAgreement: false,
    });

    expect(flags).toContain("Contract unsigned");
  });

  it("omits Contract unsigned when agreement is signed", () => {
    const flags = buildWorkOrderFlags({
      status: "open",
      vin: "ABC",
      estimated_completion: null,
      jobs: [],
      recommendations: [],
      photoCount: 2,
      hasSignedAgreement: true,
    });

    expect(flags).not.toContain("Contract unsigned");
  });

  it("omits Contract unsigned on completed work orders", () => {
    const flags = buildWorkOrderFlags({
      status: "completed",
      vin: "ABC",
      estimated_completion: null,
      jobs: [],
      recommendations: [],
      photoCount: 2,
      hasSignedAgreement: false,
    });

    expect(flags).not.toContain("Contract unsigned");
  });

  it("includes Admin flag when open", () => {
    const flags = buildWorkOrderFlags({
      status: "in_progress",
      vin: "ABC",
      estimated_completion: null,
      jobs: [],
      recommendations: [],
      photoCount: 1,
      hasOpenAdminFlag: true,
    });
    expect(flags).toContain("Admin flag");
  });

  it("does not mark completed work orders overdue", () => {
    expect(isOverdue("2020-01-01T00:00:00.000Z", "completed", new Date())).toBe(false);
  });
});
