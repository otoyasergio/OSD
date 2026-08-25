import { describe, expect, it } from "vitest";
import {
  buildLegacyReworkJobUpdate,
  collectVisitWorkerIds,
  filterEligibleQcCandidates,
} from "@/lib/jobs-v2/peerQcCompletion";
import { latestTechnicianNotes } from "@/lib/services/notes";

describe("collectVisitWorkerIds", () => {
  it("includes assigned technicians AND time-entry contributors", () => {
    const workers = collectVisitWorkerIds(
      [
        { job_id: "j1", status: "completed", assigned_technician_id: "finisher" },
        { job_id: "j2", status: "completed", assigned_technician_id: "helper-a" },
        { job_id: "j3", status: "cancelled", assigned_technician_id: null },
      ],
      [
        { job_id: "j1", user_id: "finisher" },
        { job_id: "j2", user_id: "drive-by-contributor" },
      ]
    );
    expect(workers).toEqual(new Set(["finisher", "helper-a", "drive-by-contributor"]));
  });
});

describe("filterEligibleQcCandidates", () => {
  const candidates = [
    { user_id: "finisher" },
    { user_id: "helper-a" },
    { user_id: "drive-by-contributor" },
    { user_id: "fresh-eyes" },
  ];

  it("excludes EVERY visit worker, not just the finisher", () => {
    const eligible = filterEligibleQcCandidates(
      candidates,
      new Set(["finisher", "helper-a", "drive-by-contributor"]),
      "finisher"
    );
    expect(eligible.map((c) => c.user_id)).toEqual(["fresh-eyes"]);
  });

  it("still excludes the requester when they logged no time", () => {
    const eligible = filterEligibleQcCandidates(candidates, new Set(), "finisher");
    expect(eligible.map((c) => c.user_id)).toEqual([
      "helper-a",
      "drive-by-contributor",
      "fresh-eyes",
    ]);
  });
});

describe("buildLegacyReworkJobUpdate", () => {
  it("reopens the job without touching started_at/completed_at", () => {
    const update = buildLegacyReworkJobUpdate("2026-07-20T12:00:00Z");
    expect(update).toEqual({
      status: "ready_to_start",
      updated_at: "2026-07-20T12:00:00Z",
    });
    expect("completed_at" in update).toBe(false);
    expect("started_at" in update).toBe(false);
  });
});

describe("latestTechnicianNotes", () => {
  const notes = [
    { technician_note_id: "old", created_at: "2026-07-18T09:00:00Z" },
    { technician_note_id: "newest", created_at: "2026-07-20T15:00:00Z" },
    { technician_note_id: "middle", created_at: "2026-07-19T12:00:00Z" },
  ];

  it("returns the newest N notes, newest first, regardless of input order", () => {
    const latest = latestTechnicianNotes(notes, 2);
    expect(latest.map((n) => n.technician_note_id)).toEqual(["newest", "middle"]);
  });

  it("handles limits beyond the list and zero", () => {
    expect(latestTechnicianNotes(notes, 10)).toHaveLength(3);
    expect(latestTechnicianNotes(notes, 0)).toEqual([]);
  });
});
