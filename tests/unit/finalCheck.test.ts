import { describe, expect, it } from "vitest";
import {
  declinedSafetyReleaseBlock,
  validateFinalCheck,
} from "@/lib/quality/finalCheck";

describe("validateFinalCheck", () => {
  it("requires two different accounts and a road-test result", () => {
    expect(
      validateFinalCheck({
        technicianUserId: "tech",
        verifierUserId: "tech",
        roadTestResult: "pass",
        mileageOut: 12000,
      }).ok
    ).toBe(false);
    expect(
      validateFinalCheck({
        technicianUserId: "tech",
        verifierUserId: "verifier",
        roadTestResult: "pass",
        mileageOut: 12000,
      })
    ).toEqual({ ok: true });
  });
});

describe("declinedSafetyReleaseBlock", () => {
  it("blocks release until the declined safety items are acknowledged", () => {
    expect(
      declinedSafetyReleaseBlock({
        declinedItems: ["Front brake pads"],
        acknowledged: false,
      })
    ).toBe(true);
    expect(
      declinedSafetyReleaseBlock({
        declinedItems: ["Front brake pads"],
        acknowledged: true,
      })
    ).toBe(false);
    expect(
      declinedSafetyReleaseBlock({ declinedItems: [], acknowledged: false })
    ).toBe(false);
  });
});
