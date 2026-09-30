import { describe, expect, it } from "vitest";
import { pickupLeaveBlockReason } from "@/lib/status/pickupGates";

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
