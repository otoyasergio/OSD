import { describe, expect, it } from "vitest";
import {
  getAgreementFollowUp,
  getAgreementFollowUpLabel,
} from "@/lib/status/agreementFollowUp";

describe("agreement intake follow-up", () => {
  it("reminds staff when an active work order is unsigned", () => {
    expect(getAgreementFollowUp("open", null)).toBe("signature");
  });

  it("reminds staff when a signed paper agreement has no copy", () => {
    expect(
      getAgreementFollowUp("open", {
        signature_method: "paper",
        has_paper_copy: false,
      })
    ).toBe("paper_copy");
  });

  it("clears the reminder after the paper copy is attached", () => {
    expect(
      getAgreementFollowUp("open", {
        signature_method: "paper",
        has_paper_copy: true,
      })
    ).toBeNull();
  });

  it("does not remind for a digital agreement", () => {
    expect(
      getAgreementFollowUp("open", {
        signature_method: "digital",
        has_paper_copy: false,
      })
    ).toBeNull();
  });

  it.each(["completed", "cancelled"] as const)(
    "does not show intake follow-up on %s work orders",
    (status) => {
      expect(getAgreementFollowUp(status, null)).toBeNull();
    }
  );

  it("uses short work-order list badge labels", () => {
    expect(getAgreementFollowUpLabel("signature")).toBe("Signature");
    expect(getAgreementFollowUpLabel("paper_copy")).toBe("Paper copy");
    expect(getAgreementFollowUpLabel(null)).toBeNull();
  });
});
