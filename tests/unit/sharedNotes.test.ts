import { describe, expect, it } from "vitest";
import {
  shopInstructions,
  technicianNotesOnBenchFilter,
  technicianNotesForJob,
} from "@/lib/workOrders/sharedNotes";

describe("shopInstructions", () => {
  it("keeps work-order and job instructions the floor should see", () => {
    expect(
      shopInstructions({
        internalNotes: "  Call before test ride  ",
        jobs: [
          { job_id: "job-1", service_name: "Oil change", notes: "Use 10W-40" },
          { job_id: "job-2", service_name: "Coolant", notes: "   " },
          { job_id: "job-3", service_name: "Storage", notes: null },
        ],
      })
    ).toEqual([
      {
        id: "internal",
        jobId: null,
        label: "Work order",
        body: "Call before test ride",
      },
      {
        id: "job:job-1",
        jobId: "job-1",
        label: "Oil change",
        body: "Use 10W-40",
      },
    ]);
  });

  it("returns nothing when the shop left no instructions", () => {
    expect(
      shopInstructions({
        internalNotes: null,
        jobs: [{ job_id: "job-1", service_name: "Oil change", notes: "" }],
      })
    ).toEqual([]);
  });
});

describe("technician notes the other side should see", () => {
  const notes = [
    { technician_note_id: "wo", job_id: null, note: "Bleed the front first" },
    { technician_note_id: "job", job_id: "job-1", note: "Pads were glazed" },
    { technician_note_id: "other", job_id: "job-2", note: "Other job" },
  ];

  it("puts a job's floor notes on that job, not another job's notes", () => {
    expect(
      technicianNotesForJob(notes, "job-1").map((note) => note.technician_note_id)
    ).toEqual(["job"]);
  });

  it("includes shop-wide notes on the bench for the job being worked", () => {
    expect(technicianNotesOnBenchFilter("job-1")).toBe("job_id.eq.job-1,job_id.is.null");
  });
});
