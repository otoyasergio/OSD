import { describe, it, expect } from "vitest";
import { pickPeerQcAssignee } from "@/lib/status/peerQcAssigner";
import { evaluateJobCompleteGate } from "@/lib/status/jobCompleteGate";

describe("pickPeerQcAssignee", () => {
  it("excludes workers and picks least loaded", () => {
    expect(
      pickPeerQcAssignee({
        workerUserIds: ["w1"],
        candidates: [
          { userId: "w1", openJobCount: 0, openQcCount: 0 },
          { userId: "a", openJobCount: 2, openQcCount: 1 },
          { userId: "b", openJobCount: 0, openQcCount: 0 },
        ],
      })
    ).toBe("b");
  });

  it("returns null when only workers are clocked in", () => {
    expect(
      pickPeerQcAssignee({
        workerUserIds: ["w1"],
        candidates: [{ userId: "w1", openJobCount: 1, openQcCount: 0 }],
      })
    ).toBeNull();
  });
});

describe("evaluateJobCompleteGate", () => {
  it("requires checklist, parts, and proof", () => {
    expect(
      evaluateJobCompleteGate({
        checklistItems: [{ checked_at: null }],
        parts: [],
        proofPhotoCount: 0,
        hasProofException: false,
      }).ok
    ).toBe(false);

    expect(
      evaluateJobCompleteGate({
        checklistItems: [{ checked_at: "2026-01-01" }],
        parts: [{ status: "ordered" }],
        proofPhotoCount: 1,
        hasProofException: false,
      })
    ).toMatchObject({ ok: false, code: "PARTS_NOT_INSTALLED" });

    expect(
      evaluateJobCompleteGate({
        checklistItems: [{ checked_at: "2026-01-01" }],
        parts: [{ status: "installed" }],
        proofPhotoCount: 0,
        hasProofException: true,
      }).ok
    ).toBe(true);
  });
});
