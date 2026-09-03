import { describe, expect, it } from "vitest";
import {
  computeDecisionsHash,
  isIdempotentReplay,
  validateConfirmation,
  type DecisionInput,
} from "@/lib/services/estimateAuthorization";

const PRESENTED = ["job-a", "job-b", "job-c"];

function allDecisions(): DecisionInput[] {
  return [
    { jobId: "job-a", decision: "approved" },
    { jobId: "job-b", decision: "approved" },
    { jobId: "job-c", decision: "declined" },
  ];
}

function valid() {
  return {
    presentedJobIds: PRESENTED,
    decisions: allDecisions(),
    expectedContentHash: "hash-1",
    actualContentHash: "hash-1",
    versionStatus: "presented" as const,
  };
}

describe("validateConfirmation", () => {
  it("accepts a complete decision set and returns the decisions hash", () => {
    const result = validateConfirmation(valid());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.decisionsHash).toBe(computeDecisionsHash(allDecisions()));
    }
  });

  it("requires a decision for every presented job", () => {
    const result = validateConfirmation({
      ...valid(),
      decisions: allDecisions().slice(0, 2),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors).toContain("DECISION_MISSING");
  });

  it("rejects decisions for jobs not on the presented version", () => {
    const result = validateConfirmation({
      ...valid(),
      decisions: [...allDecisions(), { jobId: "job-x", decision: "approved" }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors).toContain("DECISION_FOR_UNKNOWN_JOB");
  });

  it("rejects duplicate decisions for one job", () => {
    const result = validateConfirmation({
      ...valid(),
      decisions: [...allDecisions(), { jobId: "job-a", decision: "declined" }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors).toContain("DUPLICATE_DECISION");
  });

  it("rejects stale content (price changed since customer viewed)", () => {
    const result = validateConfirmation({
      ...valid(),
      actualContentHash: "hash-2",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors).toContain("ESTIMATE_CONTENT_STALE");
  });

  it("rejects non-presented versions", () => {
    for (const versionStatus of ["draft", "superseded", "void"] as const) {
      const result = validateConfirmation({ ...valid(), versionStatus });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors).toContain("ESTIMATE_NOT_PRESENTED");
    }
  });

  it("flags already-confirmed versions distinctly for replay handling", () => {
    const result = validateConfirmation({ ...valid(), versionStatus: "confirmed" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors).toContain("ESTIMATE_ALREADY_CONFIRMED");
  });
});

describe("decisions hash and replay", () => {
  it("is order-independent and decision-sensitive", () => {
    const shuffled = [allDecisions()[2], allDecisions()[0], allDecisions()[1]];
    expect(computeDecisionsHash(shuffled)).toBe(computeDecisionsHash(allDecisions()));

    const flipped = allDecisions().map((d) =>
      d.jobId === "job-c" ? { ...d, decision: "approved" as const } : d
    );
    expect(computeDecisionsHash(flipped)).not.toBe(computeDecisionsHash(allDecisions()));
  });

  it("treats an identical resubmission after confirmation as an idempotent replay", () => {
    expect(
      isIdempotentReplay({
        versionStatus: "confirmed",
        existingDecisionsHash: computeDecisionsHash(allDecisions()),
        submittedDecisions: allDecisions(),
      })
    ).toBe(true);
  });

  it("rejects a conflicting resubmission after confirmation", () => {
    const conflicting = allDecisions().map((d) =>
      d.jobId === "job-c" ? { ...d, decision: "approved" as const } : d
    );
    expect(
      isIdempotentReplay({
        versionStatus: "confirmed",
        existingDecisionsHash: computeDecisionsHash(allDecisions()),
        submittedDecisions: conflicting,
      })
    ).toBe(false);
  });

  it("never replays against a merely presented version", () => {
    expect(
      isIdempotentReplay({
        versionStatus: "presented",
        existingDecisionsHash: computeDecisionsHash(allDecisions()),
        submittedDecisions: allDecisions(),
      })
    ).toBe(false);
  });
});
