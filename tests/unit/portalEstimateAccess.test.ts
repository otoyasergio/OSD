import { describe, expect, it } from "vitest";
import {
  portalDeclineAllowed,
  portalPurposeAllowsContract,
  portalPurposeAllowsEstimate,
  type PortalTokenPurpose,
} from "@/lib/services/portal";
import { validateConfirmation } from "@/lib/services/estimateAuthorization";

const ALL_PURPOSES: PortalTokenPurpose[] = [
  "full",
  "estimate",
  "payment",
  "inspection",
  "contract",
];

describe("portal token purpose gating", () => {
  it("only estimate and full tokens may act on estimates", () => {
    const allowed = ALL_PURPOSES.filter(portalPurposeAllowsEstimate);
    expect(allowed).toEqual(["full", "estimate"]);
  });

  it("payment, inspection, and contract tokens are denied estimate access", () => {
    expect(portalPurposeAllowsEstimate("payment")).toBe(false);
    expect(portalPurposeAllowsEstimate("inspection")).toBe(false);
    expect(portalPurposeAllowsEstimate("contract")).toBe(false);
  });

  it("only contract and full tokens may sign the agreement", () => {
    const allowed = ALL_PURPOSES.filter(portalPurposeAllowsContract);
    expect(allowed).toEqual(["full", "contract"]);
  });
});

describe("legacy portal decline guard", () => {
  it("permits declining only jobs awaiting a decision", () => {
    expect(portalDeclineAllowed("waiting_for_approval")).toBe(true);
    for (const status of [
      "draft",
      "approved",
      "declined",
      "waiting_for_parts",
      "ready_to_start",
      "in_progress",
      "completed",
      "cancelled",
    ]) {
      expect(portalDeclineAllowed(status)).toBe(false);
    }
  });
});

describe("portal confirmation pre-validation", () => {
  const presented = ["job-a", "job-b"];

  it("requires a decision for every presented job before submission", () => {
    const result = validateConfirmation({
      presentedJobIds: presented,
      decisions: [{ jobId: "job-a", decision: "approved" }],
      expectedContentHash: "h",
      actualContentHash: "h",
      versionStatus: "presented",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors).toContain("DECISION_MISSING");
  });

  it("maps a price change since render to a stale-content rejection", () => {
    const result = validateConfirmation({
      presentedJobIds: presented,
      decisions: [
        { jobId: "job-a", decision: "approved" },
        { jobId: "job-b", decision: "declined" },
      ],
      expectedContentHash: "seen-by-customer",
      actualContentHash: "changed-by-staff",
      versionStatus: "presented",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors).toContain("ESTIMATE_CONTENT_STALE");
  });
});
