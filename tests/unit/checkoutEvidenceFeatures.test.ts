import { describe, expect, it } from "vitest";
import { checkoutEvidenceEnabled } from "@/lib/config/features";

describe("checkoutEvidenceEnabled", () => {
  it("defaults to false so existing shops stay on the current workflow", () => {
    expect(checkoutEvidenceEnabled({})).toBe(false);
    expect(checkoutEvidenceEnabled({ CHECKOUT_EVIDENCE_ENABLED: "" })).toBe(false);
    expect(checkoutEvidenceEnabled({ CHECKOUT_EVIDENCE_ENABLED: "0" })).toBe(false);
    expect(checkoutEvidenceEnabled({ CHECKOUT_EVIDENCE_ENABLED: "true" })).toBe(false);
  });

  it("is true only when CHECKOUT_EVIDENCE_ENABLED=1", () => {
    expect(checkoutEvidenceEnabled({ CHECKOUT_EVIDENCE_ENABLED: "1" })).toBe(true);
  });
});
