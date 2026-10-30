import { describe, expect, it } from "vitest";
import {
  pickupLeaveBlockReason,
  storageLeaveBlockReason,
} from "@/lib/status/pickupGates";

describe("pickupLeaveBlockReason", () => {
  it("requires arrival inspection then QC then final inspection", () => {
    expect(
      pickupLeaveBlockReason({
        inspectionComplete: false,
        qualityChecked: false,
        safetyRequired: true,
        safetyChecked: false,
      })
    ).toBe("INSPECTION_REQUIRED_BEFORE_PICKUP");

    expect(
      pickupLeaveBlockReason({
        inspectionComplete: true,
        qualityChecked: false,
        safetyRequired: true,
        safetyChecked: false,
      })
    ).toBe("QC_REQUIRED");

    expect(
      pickupLeaveBlockReason({
        inspectionComplete: true,
        qualityChecked: false,
        safetyRequired: true,
        safetyChecked: false,
        waiveQualityCheck: true,
      })
    ).toBe("SAFETY_REQUIRED_BEFORE_PICKUP");

    expect(
      pickupLeaveBlockReason({
        inspectionComplete: true,
        qualityChecked: false,
        safetyRequired: true,
        safetyChecked: false,
        waiveQualityCheck: true,
        waiveSafetyCheck: true,
      })
    ).toBeNull();

    expect(
      pickupLeaveBlockReason({
        inspectionComplete: true,
        qualityChecked: true,
        safetyRequired: true,
        safetyChecked: false,
      })
    ).toBe("SAFETY_REQUIRED_BEFORE_PICKUP");

    expect(
      pickupLeaveBlockReason({
        inspectionComplete: true,
        qualityChecked: true,
        safetyRequired: true,
        safetyChecked: true,
      })
    ).toBeNull();
  });

  it("lets a finished bike enter storage without checkout photos", () => {
    expect(
      storageLeaveBlockReason({
        inspectionComplete: true,
        qualityChecked: true,
        safetyRequired: true,
        safetyChecked: true,
      })
    ).toBeNull();

    expect(
      pickupLeaveBlockReason({
        inspectionComplete: true,
        qualityChecked: true,
        safetyRequired: true,
        safetyChecked: true,
        checkoutEvidenceRequired: true,
        checkoutEvidenceComplete: false,
      })
    ).toBe("CHECKOUT_EVIDENCE_REQUIRED");
  });

  it("requires inspection and QC before storage, and does not require final inspection", () => {
    expect(
      storageLeaveBlockReason({
        inspectionComplete: false,
        qualityChecked: true,
        safetyRequired: false,
        safetyChecked: false,
      })
    ).toBe("INSPECTION_REQUIRED_BEFORE_PICKUP");
    expect(
      storageLeaveBlockReason({
        inspectionComplete: true,
        qualityChecked: false,
        safetyRequired: false,
        safetyChecked: false,
      })
    ).toBe("QC_REQUIRED");
    expect(
      storageLeaveBlockReason({
        inspectionComplete: true,
        qualityChecked: true,
        safetyRequired: true,
        safetyChecked: false,
      })
    ).toBeNull();
    expect(
      storageLeaveBlockReason({
        inspectionComplete: true,
        qualityChecked: false,
        safetyRequired: true,
        safetyChecked: false,
        waiveQualityCheck: true,
      })
    ).toBeNull();
  });

  it("lets the owner skip every leave gate", () => {
    expect(
      pickupLeaveBlockReason({
        inspectionComplete: false,
        qualityChecked: false,
        safetyRequired: true,
        safetyChecked: false,
        checkoutEvidenceRequired: true,
        checkoutEvidenceComplete: false,
        skipAllGates: true,
      })
    ).toBeNull();
    expect(
      storageLeaveBlockReason({
        inspectionComplete: false,
        qualityChecked: false,
        safetyRequired: true,
        safetyChecked: false,
        skipAllGates: true,
      })
    ).toBeNull();
  });

  it("skips final inspection when waived", () => {
    expect(
      pickupLeaveBlockReason({
        inspectionComplete: true,
        qualityChecked: true,
        safetyRequired: false,
        safetyChecked: false,
      })
    ).toBeNull();
  });
});
