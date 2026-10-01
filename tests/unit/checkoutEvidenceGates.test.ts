import { describe, expect, it } from "vitest";
import { pickupLeaveBlockReason } from "@/lib/status/pickupGates";

const inspectionQcSafetyReady = {
  inspectionComplete: true,
  qualityChecked: true,
  safetyRequired: true,
  safetyChecked: true,
};

describe("pickupLeaveBlockReason checkout evidence", () => {
  it("lets legacy work orders through when checkout evidence is not required", () => {
    expect(
      pickupLeaveBlockReason({
        ...inspectionQcSafetyReady,
        checkoutEvidenceRequired: false,
        checkoutEvidenceComplete: false,
        checkoutEvidenceOverridden: false,
      })
    ).toBeNull();
  });

  it("blocks only after inspection, QC, and safety when required evidence is missing", () => {
    expect(
      pickupLeaveBlockReason({
        inspectionComplete: false,
        qualityChecked: false,
        safetyRequired: true,
        safetyChecked: false,
        checkoutEvidenceRequired: true,
        checkoutEvidenceComplete: false,
        checkoutEvidenceOverridden: false,
      })
    ).toBe("INSPECTION_REQUIRED_BEFORE_PICKUP");

    expect(
      pickupLeaveBlockReason({
        inspectionComplete: true,
        qualityChecked: false,
        safetyRequired: true,
        safetyChecked: false,
        checkoutEvidenceRequired: true,
        checkoutEvidenceComplete: false,
        checkoutEvidenceOverridden: false,
      })
    ).toBe("QC_REQUIRED");

    expect(
      pickupLeaveBlockReason({
        inspectionComplete: true,
        qualityChecked: true,
        safetyRequired: true,
        safetyChecked: false,
        checkoutEvidenceRequired: true,
        checkoutEvidenceComplete: false,
        checkoutEvidenceOverridden: false,
      })
    ).toBe("SAFETY_REQUIRED_BEFORE_PICKUP");

    expect(
      pickupLeaveBlockReason({
        ...inspectionQcSafetyReady,
        checkoutEvidenceRequired: true,
        checkoutEvidenceComplete: false,
        checkoutEvidenceOverridden: false,
      })
    ).toBe("CHECKOUT_EVIDENCE_REQUIRED");
  });

  it("passes when the five categories are complete or a persisted override exists", () => {
    expect(
      pickupLeaveBlockReason({
        ...inspectionQcSafetyReady,
        checkoutEvidenceRequired: true,
        checkoutEvidenceComplete: true,
        checkoutEvidenceOverridden: false,
      })
    ).toBeNull();

    expect(
      pickupLeaveBlockReason({
        ...inspectionQcSafetyReady,
        checkoutEvidenceRequired: true,
        checkoutEvidenceComplete: false,
        checkoutEvidenceOverridden: true,
      })
    ).toBeNull();
  });
});
