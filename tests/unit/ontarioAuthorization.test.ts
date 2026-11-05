import { describe, expect, it } from "vitest";
import {
  chargeableStartDecision,
  estimateFeeCents,
  exceedsAuthorizedCeiling,
  warrantySnapshotText,
} from "@/lib/accountability/ontarioAuthorization";

const ceiling = 1000;

describe("chargeableStartDecision", () => {
  it("allows a zero-dollar job with no estimate", () => {
    expect(
      chargeableStartDecision({
        priceCents: 0,
        legacyApproved: false,
        jobApprovedOnConfirmedVersion: false,
        estimateDocumentExists: false,
        maximumAuthorizationCents: null,
        alreadyAuthorizedSpendCents: 0,
        ceilingBps: ceiling,
      })
    ).toEqual({ ok: true });
  });

  it("allows a legacy approved job when no estimate document exists", () => {
    expect(
      chargeableStartDecision({
        priceCents: 14500,
        legacyApproved: true,
        jobApprovedOnConfirmedVersion: false,
        estimateDocumentExists: false,
        maximumAuthorizationCents: null,
        alreadyAuthorizedSpendCents: 0,
        ceilingBps: ceiling,
      }).ok
    ).toBe(true);
  });

  it("blocks chargeable work when an estimate exists and this job is not on it", () => {
    expect(
      chargeableStartDecision({
        priceCents: 8000,
        legacyApproved: true,
        jobApprovedOnConfirmedVersion: false,
        estimateDocumentExists: true,
        maximumAuthorizationCents: null,
        alreadyAuthorizedSpendCents: 14500,
        ceilingBps: ceiling,
      })
    ).toEqual({ ok: false, reason: "NEEDS_SUPPLEMENTAL_ESTIMATE" });
  });

  it("allows added work inside a recorded maximum, including the 10 percent ceiling", () => {
    expect(
      chargeableStartDecision({
        priceCents: 1000,
        legacyApproved: false,
        jobApprovedOnConfirmedVersion: false,
        estimateDocumentExists: true,
        maximumAuthorizationCents: 10000,
        alreadyAuthorizedSpendCents: 10000,
        ceilingBps: ceiling,
      }).ok
    ).toBe(true);
  });

  it("refuses work past the authorized maximum plus the statutory ceiling", () => {
    expect(
      chargeableStartDecision({
        priceCents: 1001,
        legacyApproved: false,
        jobApprovedOnConfirmedVersion: false,
        estimateDocumentExists: false,
        maximumAuthorizationCents: 10000,
        alreadyAuthorizedSpendCents: 10000,
        ceilingBps: ceiling,
      })
    ).toEqual({ ok: false, reason: "EXCEEDS_AUTHORIZED_MAXIMUM" });
  });
});

describe("exceedsAuthorizedCeiling", () => {
  it("treats 10 percent as the default ceiling and nothing beyond it", () => {
    expect(exceedsAuthorizedCeiling(10000, 11000, 1000)).toBe(false);
    expect(exceedsAuthorizedCeiling(10000, 11001, 1000)).toBe(true);
  });
});

describe("estimate fees and warranty text", () => {
  it("charges an estimate fee only when it was disclosed and the repair does not proceed", () => {
    expect(
      estimateFeeCents({
        feeCents: 5000,
        disclosed: true,
        repairProceeding: false,
      })
    ).toBe(5000);
    expect(
      estimateFeeCents({
        feeCents: 5000,
        disclosed: false,
        repairProceeding: false,
      })
    ).toBe(0);
    expect(
      estimateFeeCents({
        feeCents: 5000,
        disclosed: true,
        repairProceeding: true,
      })
    ).toBe(0);
  });

  it("keeps statutory exemptions separate from manufacturer and shop warranties", () => {
    const text = warrantySnapshotText({
      summary: "Minimum statutory warranty on most repairs.",
      exemptions: "Fluids, filters, lights, tires, and batteries.",
    });
    expect(text).toMatch(/statutory/i);
    expect(text).toMatch(/Fluids, filters, lights, tires, and batteries/);
    expect(text).toMatch(/manufacturer/i);
    expect(text).toMatch(/shop warranty/i);
  });
});
