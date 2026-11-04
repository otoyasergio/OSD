import { describe, expect, it } from "vitest";
import {
  NOTHING_TO_PHOTOGRAPH_NOTE,
  SWAP_BENCH_NOTE,
  evaluatePerformWorkDocumentation,
  journalCounts,
  parkNoteForReason,
} from "@/lib/status/workDocumentation";

describe("evaluatePerformWorkDocumentation", () => {
  it("blocks when the job has no written line and no photo", () => {
    expect(evaluatePerformWorkDocumentation({ notes: [], photos: [] })).toEqual({
      ok: false,
      code: "WORK_LINE_REQUIRED",
      reason: "Write what you found or did before marking this work done.",
    });
  });

  it("asks for a photo after a written line when nothing was photographed", () => {
    expect(
      evaluatePerformWorkDocumentation({
        notes: [{ note: "Replaced the front pads.", note_type: "general" }],
        photos: [],
      })
    ).toEqual({
      ok: false,
      code: "WORK_PHOTO_REQUIRED",
      reason: "Add a work photo or tap Nothing to photograph.",
    });
  });

  it("accepts a captioned work photo as both the line and the photo", () => {
    expect(
      evaluatePerformWorkDocumentation({
        notes: [],
        photos: [{ category: "job_work", notes: "Old pads were glazed." }],
      })
    ).toEqual({ ok: true });
  });

  it("accepts a note plus an uncaptioned work photo", () => {
    expect(
      evaluatePerformWorkDocumentation({
        notes: [{ note: "Torqued the axle.", note_type: "general" }],
        photos: [{ category: "job_work", notes: null }],
      })
    ).toEqual({ ok: true });
  });

  it("treats Nothing to photograph as the written line and the photo waiver", () => {
    expect(
      evaluatePerformWorkDocumentation({
        notes: [{ note: NOTHING_TO_PHOTOGRAPH_NOTE, note_type: "general" }],
        photos: [],
      })
    ).toEqual({ ok: true });
  });

  it("ignores proof photos and proof-exception notes", () => {
    expect(
      evaluatePerformWorkDocumentation({
        notes: [{ note: "Proof skipped: Camera busy", note_type: "proof_exception" }],
        photos: [{ category: "job_proof", notes: "Finished bike" }],
      })
    ).toMatchObject({ ok: false, code: "WORK_LINE_REQUIRED" });
  });
});

describe("journalCounts", () => {
  it("counts work photos and general notes only", () => {
    expect(
      journalCounts({
        notes: [
          { note: "Found a weep at the caliper.", note_type: "general" },
          { note: "Proof skipped: Camera busy", note_type: "proof_exception" },
          { note: "   ", note_type: "general" },
        ],
        photos: [
          { category: "job_work", notes: "Caliper" },
          { category: "job_work", notes: null },
          { category: "job_proof", notes: "After" },
        ],
      })
    ).toEqual({ photos: 2, notes: 1 });
  });
});

describe("parkNoteForReason", () => {
  it("requires a line for an explicit park", () => {
    expect(() => parkNoteForReason("parts", "  ")).toThrow("PARK_NOTE_REQUIRED");
    expect(parkNoteForReason("approval", " Waiting on the brake quote. ")).toBe(
      "Waiting on the brake quote."
    );
  });

  it("writes the swap sentence when the tech jumps bikes", () => {
    expect(parkNoteForReason("swapped", null)).toBe(SWAP_BENCH_NOTE);
    expect(parkNoteForReason("swapped", "  ")).toBe(SWAP_BENCH_NOTE);
  });
});
