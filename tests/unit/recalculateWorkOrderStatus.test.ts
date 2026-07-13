import { describe, it, expect } from "vitest";
import { deriveWorkOrderStatus } from "@/lib/status/recalculateWorkOrderStatus";

describe("deriveWorkOrderStatus", () => {
  it("does not change completed", () => {
    expect(
      deriveWorkOrderStatus({
        currentStatus: "completed",
        jobs: [],
        parts: [],
        inspectionComplete: true,
        qualityCheckComplete: true,
      })
    ).toBe("completed");
  });

  it("does not change cancelled", () => {
    expect(
      deriveWorkOrderStatus({
        currentStatus: "cancelled",
        jobs: [{ status: "approved" }],
        parts: [],
        inspectionComplete: true,
        qualityCheckComplete: false,
      })
    ).toBe("cancelled");
  });

  it("does not change on_hold", () => {
    expect(
      deriveWorkOrderStatus({
        currentStatus: "on_hold",
        jobs: [{ status: "in_progress" }],
        parts: [],
        inspectionComplete: true,
        qualityCheckComplete: false,
      })
    ).toBe("on_hold");
  });

  it("sets waiting_for_customer_approval when any job waiting", () => {
    expect(
      deriveWorkOrderStatus({
        currentStatus: "open",
        jobs: [{ status: "waiting_for_approval" }, { status: "approved" }],
        parts: [],
        inspectionComplete: true,
        qualityCheckComplete: false,
      })
    ).toBe("waiting_for_customer_approval");
  });

  it("sets waiting_for_parts when approved job has needed/ordered parts", () => {
    expect(
      deriveWorkOrderStatus({
        currentStatus: "open",
        jobs: [{ status: "approved", job_id: "j1" }],
        parts: [{ job_id: "j1", status: "ordered" }],
        inspectionComplete: true,
        qualityCheckComplete: false,
      })
    ).toBe("waiting_for_parts");
  });

  it("sets in_progress when any job in_progress", () => {
    expect(
      deriveWorkOrderStatus({
        currentStatus: "ready_for_technician",
        jobs: [{ status: "in_progress" }],
        parts: [],
        inspectionComplete: true,
        qualityCheckComplete: false,
      })
    ).toBe("in_progress");
  });

  it("sets quality_check when all active jobs completed and QC missing", () => {
    expect(
      deriveWorkOrderStatus({
        currentStatus: "in_progress",
        jobs: [{ status: "completed" }, { status: "declined" }],
        parts: [],
        inspectionComplete: true,
        qualityCheckComplete: false,
      })
    ).toBe("quality_check");
  });

  it("derives active status from open after resume from hold", () => {
    // Resume-from-hold resets status to "open" before recalculating.
    expect(
      deriveWorkOrderStatus({
        currentStatus: "open",
        jobs: [{ status: "in_progress" }],
        parts: [],
        inspectionComplete: true,
        qualityCheckComplete: false,
      })
    ).toBe("in_progress");

    expect(
      deriveWorkOrderStatus({
        currentStatus: "open",
        jobs: [{ status: "waiting_for_approval" }],
        parts: [],
        inspectionComplete: true,
        qualityCheckComplete: false,
      })
    ).toBe("waiting_for_customer_approval");

    expect(
      deriveWorkOrderStatus({
        currentStatus: "open",
        jobs: [],
        parts: [],
        inspectionComplete: false,
        qualityCheckComplete: false,
      })
    ).toBe("open");
  });

  it("sets ready_for_pickup when QC complete and not completed", () => {
    expect(
      deriveWorkOrderStatus({
        currentStatus: "quality_check",
        jobs: [{ status: "completed" }],
        parts: [],
        inspectionComplete: true,
        qualityCheckComplete: true,
      })
    ).toBe("ready_for_pickup");
  });

  it("sets ready_for_technician when all jobs approved and contract signed", () => {
    expect(
      deriveWorkOrderStatus({
        currentStatus: "waiting_for_customer_approval",
        jobs: [{ status: "approved" }, { status: "ready_to_start" }],
        parts: [],
        inspectionComplete: true,
        qualityCheckComplete: false,
        hasSignedAgreement: true,
      })
    ).toBe("ready_for_technician");
  });

  it("does not promote to ready_for_technician while contract unsigned", () => {
    expect(
      deriveWorkOrderStatus({
        currentStatus: "open",
        jobs: [{ status: "approved" }],
        parts: [],
        inspectionComplete: true,
        qualityCheckComplete: false,
        hasSignedAgreement: false,
      })
    ).toBe("open");

    expect(
      deriveWorkOrderStatus({
        currentStatus: "waiting_for_customer_approval",
        jobs: [{ status: "approved" }],
        parts: [],
        inspectionComplete: true,
        qualityCheckComplete: false,
        hasSignedAgreement: false,
      })
    ).toBe("waiting_for_customer_approval");
  });

  it("demotes ready_for_technician to open when contract becomes unsigned", () => {
    expect(
      deriveWorkOrderStatus({
        currentStatus: "ready_for_technician",
        jobs: [{ status: "approved" }],
        parts: [],
        inspectionComplete: true,
        qualityCheckComplete: false,
        hasSignedAgreement: false,
      })
    ).toBe("open");
  });
});
