import { describe, it, expect } from "vitest";
import { pickPeerQcAssignee } from "@/lib/status/peerQcAssigner";
import { countProofPhotos, evaluateJobCompleteGate } from "@/lib/status/jobCompleteGate";

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

  it("blocks when inspection is incomplete", () => {
    expect(
      evaluateJobCompleteGate({
        checklistItems: [{ checked_at: "2026-01-01" }],
        parts: [{ status: "installed" }],
        proofPhotoCount: 1,
        hasProofException: false,
        inspectionComplete: false,
      })
    ).toMatchObject({ ok: false, code: "INSPECTION_NOT_COMPLETED" });
  });

  it("only job_proof photos satisfy the proof gate — job_work never does", () => {
    const photos = [{ category: "job_work" }, { category: "job_work" }];
    expect(
      evaluateJobCompleteGate({
        checklistItems: [{ checked_at: "2026-01-01" }],
        parts: [{ status: "installed" }],
        proofPhotoCount: countProofPhotos(photos),
        hasProofException: false,
      })
    ).toMatchObject({ ok: false, code: "PROOF_REQUIRED" });

    expect(
      evaluateJobCompleteGate({
        checklistItems: [{ checked_at: "2026-01-01" }],
        parts: [{ status: "installed" }],
        proofPhotoCount: countProofPhotos([...photos, { category: "job_proof" }]),
        hasProofException: false,
      }).ok
    ).toBe(true);
  });
});
