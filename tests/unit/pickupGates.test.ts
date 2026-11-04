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
        inspectionDone: true,
        awaitingApproval: [],
        unfinishedApproved: [],
        partsOutstanding: [],
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

  it("requires inspection and finished approved work before storage, not final inspection", () => {
    const open = {
      inspectionDone: true,
      awaitingApproval: [],
      unfinishedApproved: [],
      partsOutstanding: [],
    };
    expect(storageLeaveBlockReason({ ...open, inspectionDone: false })).toBe(
      "INSPECTION_REQUIRED_BEFORE_PICKUP"
    );
    expect(
      storageLeaveBlockReason({
        ...open,
        awaitingApproval: [{ id: "j1", name: "Tires" }],
      })
    ).toBe("STORAGE_ESTIMATE_OPEN");
    expect(
      storageLeaveBlockReason({
        ...open,
        unfinishedApproved: [{ id: "j2", name: "Oil" }],
      })
    ).toBe("STORAGE_WORK_INCOMPLETE");
    expect(
      storageLeaveBlockReason({
        ...open,
        partsOutstanding: [{ id: "p1", name: "Filter" }],
      })
    ).toBe("STORAGE_WORK_INCOMPLETE");
    expect(storageLeaveBlockReason(open)).toBeNull();
  });

  it("lets the owner skip pickup gates and still blocks an unfinished storage drop", () => {
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
        inspectionDone: false,
        awaitingApproval: [],
        unfinishedApproved: [],
        partsOutstanding: [],
      })
    ).toBe("INSPECTION_REQUIRED_BEFORE_PICKUP");
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
