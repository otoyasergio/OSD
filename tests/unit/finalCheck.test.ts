import { describe, expect, it } from "vitest";
import { declinedSafetyReleaseBlock, validateFinalCheck } from "@/lib/quality/finalCheck";

const frontOffice = { actorUserId: "advisor", actorIsFrontOffice: true };

describe("validateFinalCheck", () => {
  it("requires two different accounts and a road-test result", () => {
    expect(
      validateFinalCheck({
        technicianUserId: "tech",
        verifierUserId: "tech",
        roadTestResult: "pass",
        mileageOut: 12000,
        ...frontOffice,
      }).ok
    ).toBe(false);
    expect(
      validateFinalCheck({
        technicianUserId: "tech",
        verifierUserId: "verifier",
        roadTestResult: "pass",
        mileageOut: 12000,
        ...frontOffice,
      })
    ).toEqual({ ok: true });
  });

  it("never lets the technician who did the work record the check", () => {
    expect(
      validateFinalCheck({
        technicianUserId: "tech",
        verifierUserId: "verifier",
        roadTestResult: "pass",
        mileageOut: null,
        actorUserId: "tech",
        actorIsFrontOffice: false,
      })
    ).toEqual({
      ok: false,
      errors: ["FINAL_CHECK_SELF_RECORDED", "FINAL_CHECK_VERIFIER_MUST_RECORD"],
    });
  });

  it("lets the floor record only when the verifier is the signed-in account", () => {
    expect(
      validateFinalCheck({
        technicianUserId: "tech",
        verifierUserId: "verifier",
        roadTestResult: "pass",
        mileageOut: null,
        actorUserId: "someone-else",
        actorIsFrontOffice: false,
      })
    ).toEqual({ ok: false, errors: ["FINAL_CHECK_VERIFIER_MUST_RECORD"] });
    expect(
      validateFinalCheck({
        technicianUserId: "tech",
        verifierUserId: "verifier",
        roadTestResult: "pass",
        mileageOut: null,
        actorUserId: "verifier",
        actorIsFrontOffice: false,
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
    expect(declinedSafetyReleaseBlock({ declinedItems: [], acknowledged: false })).toBe(
      false
    );
  });
});
