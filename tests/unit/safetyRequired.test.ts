import { describe, expect, it } from "vitest";
import { deriveWorkOrderStatus } from "@/lib/status/recalculateWorkOrderStatus";
import { isSafetyRequired } from "@/lib/status/safetyRequired";
import { pickupLeaveBlockReason } from "@/lib/status/pickupGates";

describe("isSafetyRequired", () => {
  it("is false when waived even with Safety Inspection job", () => {
    expect(
      isSafetyRequired({
        safety_required: null,
        safety_waived: true,
        jobs: [{ status: "completed", service_name_snapshot: "Safety Inspection" }],
      })
    ).toBe(false);
  });

  it("is true for ordinary service visits so they cannot skip final inspection", () => {
    expect(
      isSafetyRequired({
        safety_required: null,
        safety_waived: false,
        jobs: [{ status: "completed", service_name_snapshot: "Oil Change" }],
      })
    ).toBe(true);
  });

  it("is true when forced even without Safety Inspection job", () => {
    expect(
      isSafetyRequired({
        safety_required: true,
        safety_waived: false,
        jobs: [{ status: "completed", service_name_snapshot: "Oil Change" }],
      })
    ).toBe(true);
  });
});

describe("QC then safety", () => {
  it("holds an oil-only visit in safety_check after QC until head tech stamps it", () => {
    const safetyRequired = isSafetyRequired({
      safety_required: null,
      safety_waived: false,
      jobs: [{ status: "completed", service_name_snapshot: "Oil Change" }],
    });
    expect(
      deriveWorkOrderStatus({
        currentStatus: "quality_check",
        jobs: [{ status: "completed", service_name_snapshot: "Oil Change" }],
        parts: [],
        inspectionComplete: true,
        qualityCheckComplete: true,
        safetyRequired,
        safetyCheckComplete: false,
      })
    ).toBe("safety_check");
  });
});

describe("pickupLeaveBlockReason", () => {
  const ready = {
    inspectionComplete: true,
    qualityChecked: true,
    safetyRequired: true,
    safetyChecked: true,
  };

  it("blocks pickup when the inspection report is unfinished", () => {
    expect(pickupLeaveBlockReason({ ...ready, inspectionComplete: false })).toBe(
      "INSPECTION_REQUIRED_BEFORE_PICKUP"
    );
  });

  it("blocks pickup when QC has not passed", () => {
    expect(pickupLeaveBlockReason({ ...ready, qualityChecked: false })).toBe(
      "QC_REQUIRED"
    );
  });

  it("blocks pickup when final safety is still outstanding", () => {
    expect(pickupLeaveBlockReason({ ...ready, safetyChecked: false })).toBe(
      "SAFETY_REQUIRED_BEFORE_PICKUP"
    );
  });

  it("allows pickup after inspection, QC, and safety", () => {
    expect(pickupLeaveBlockReason(ready)).toBeNull();
  });

  it("allows pickup when office waived safety", () => {
    expect(
      pickupLeaveBlockReason({ ...ready, safetyRequired: false, safetyChecked: false })
    ).toBeNull();
  });
});
