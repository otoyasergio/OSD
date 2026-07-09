import { describe, it, expect } from "vitest";
import type { JobStatus } from "@/lib/database/types";

const ORDERABLE_JOB_STATUSES: JobStatus[] = [
  "approved",
  "waiting_for_parts",
  "ready_to_start",
  "in_progress",
];

function assertCanOrder(jobStatus: JobStatus) {
  if (!ORDERABLE_JOB_STATUSES.includes(jobStatus)) {
    throw new Error("Parts cannot be ordered before customer approval.");
  }
}

describe("parts approval-before-order rule", () => {
  it("blocks ordering when job awaits approval", () => {
    expect(() => assertCanOrder("waiting_for_approval")).toThrow(
      "Parts cannot be ordered before customer approval."
    );
    expect(() => assertCanOrder("draft")).toThrow();
    expect(() => assertCanOrder("declined")).toThrow();
  });

  it("allows ordering after approval", () => {
    expect(() => assertCanOrder("approved")).not.toThrow();
    expect(() => assertCanOrder("waiting_for_parts")).not.toThrow();
    expect(() => assertCanOrder("ready_to_start")).not.toThrow();
    expect(() => assertCanOrder("in_progress")).not.toThrow();
  });
});
