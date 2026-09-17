import { describe, expect, it } from "vitest";
import { countProofPhotos, evaluateJobCompleteGate } from "@/lib/status/jobCompleteGate";
import { photoCategorySchema, intakePhotoSchema } from "@/lib/validation/schemas";

describe("floor photo classification", () => {
  it("accepts job_work as a valid photo category", () => {
    expect(photoCategorySchema.parse("job_work")).toBe("job_work");
    expect(photoCategorySchema.parse("job_proof")).toBe("job_proof");
  });

  it("intake photo schema accepts a job-pinned work photo", () => {
    const parsed = intakePhotoSchema.parse({
      category: "job_work",
      notes: "mid-service torque check",
      job_id: "123e4567-e89b-42d3-a456-426614174000",
    });
    expect(parsed.category).toBe("job_work");
  });

  it("countProofPhotos counts only job_proof", () => {
    expect(
      countProofPhotos([
        { category: "job_work" },
        { category: "job_work" },
        { category: "job_proof" },
        { category: "other" },
        { category: null },
      ])
    ).toBe(1);
    expect(countProofPhotos([{ category: "job_work" }])).toBe(0);
  });

  it("work-journal photos never satisfy the proof gate", () => {
    const journalOnly = countProofPhotos([
      { category: "job_work" },
      { category: "job_work" },
    ]);
    expect(
      evaluateJobCompleteGate({
        checklistItems: [{ checked_at: "2026-07-20T10:00:00Z" }],
        parts: [{ status: "installed" }],
        proofPhotoCount: journalOnly,
        hasProofException: false,
      })
    ).toMatchObject({ ok: false, code: "PROOF_REQUIRED" });
  });

  it("a proof photo (or proof exception) still satisfies the gate", () => {
    const mixed = countProofPhotos([{ category: "job_work" }, { category: "job_proof" }]);
    expect(
      evaluateJobCompleteGate({
        checklistItems: [{ checked_at: "2026-07-20T10:00:00Z" }],
        parts: [],
        proofPhotoCount: mixed,
        hasProofException: false,
      }).ok
    ).toBe(true);
  });
});
