import { describe, expect, it } from "vitest";
import { computeQcScopeHash } from "@/lib/jobs-v2/scopeHash";

const JOB_A = {
  jobId: "aaaaaaaa-0000-0000-0000-000000000001",
  completedAt: "2026-07-20T10:00:00Z",
};
const JOB_B = {
  jobId: "bbbbbbbb-0000-0000-0000-000000000002",
  completedAt: "2026-07-20T11:30:00Z",
};

describe("computeQcScopeHash", () => {
  it("returns a sha256 hex string", () => {
    expect(computeQcScopeHash([JOB_A])).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic and order-insensitive", () => {
    const forward = computeQcScopeHash([JOB_A, JOB_B]);
    const reversed = computeQcScopeHash([JOB_B, JOB_A]);
    expect(forward).toBe(reversed);
    expect(computeQcScopeHash([JOB_A, JOB_B])).toBe(forward);
  });

  it("changes when a job is added or removed", () => {
    expect(computeQcScopeHash([JOB_A])).not.toBe(computeQcScopeHash([JOB_A, JOB_B]));
    expect(computeQcScopeHash([])).not.toBe(computeQcScopeHash([JOB_A]));
  });

  it("changes when a completion timestamp changes (rework detection)", () => {
    const reworked = { ...JOB_A, completedAt: "2026-07-21T09:00:00Z" };
    expect(computeQcScopeHash([JOB_A, JOB_B])).not.toBe(
      computeQcScopeHash([reworked, JOB_B])
    );
  });

  it("tolerates null completedAt without collapsing distinct jobs", () => {
    const aNull = { ...JOB_A, completedAt: null };
    const bNull = { ...JOB_B, completedAt: null };
    expect(computeQcScopeHash([aNull, bNull])).not.toBe(computeQcScopeHash([aNull]));
    expect(computeQcScopeHash([aNull])).not.toBe(computeQcScopeHash([JOB_A]));
  });
});
