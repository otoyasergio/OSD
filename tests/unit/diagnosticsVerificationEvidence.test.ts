import { describe, expect, it } from "vitest";
import {
  shapeDiagnosticsContext,
  type DiagnosticsContextSource,
} from "@/lib/diagnostics/context";
import { inspectDiagnosticsOutput } from "@/lib/diagnostics/outputPolicy";
import type { DiagnosticsResponse } from "@/lib/diagnostics/responseSchema";
import { classifyVerificationNote } from "@/lib/services/diagnosticsAssistant";

const recordedAt = "2026-09-29T09:00:00.000Z";

function source(notes: string[]): DiagnosticsContextSource {
  return {
    workOrder: {
      workOrderId: "wo-1",
      workOrderNumber: "WO-1",
      status: "in_progress",
    },
    motorcycle: {
      year: 2024,
      make: "Honda",
      model: "CB500F",
    },
    jobs: [
      {
        jobId: "job-1",
        workOrderId: "wo-1",
        origin: "customer_request",
        serviceName: "Charging repair",
        status: "completed",
        verification: notes.map((note, index) => ({
          verificationId: `verification-${index}`,
          result: classifyVerificationNote(note),
          notes: note,
          recordedAt,
        })),
      },
    ],
  };
}

function positiveVerificationDraft(): DiagnosticsResponse {
  return {
    phase: "verification",
    review_status: "staff_review_required",
    answer: "The charging repair was verified and the concern was resolved.",
    assessments: [],
    requested_input: {
      type: "none",
      prompt: null,
      purpose: null,
      tool_placement: null,
      conditions: null,
      units: null,
    },
    next_step: "Record the reviewed result.",
    safety: { stop_work: false, do_not_ride: false, boundary: null },
    sources: [],
    source_summary: "No exact-model source supplied.",
    limitations: [],
    shop_log_entry: null,
  };
}

describe("recorded verification-note classification", () => {
  it.each([
    "Comparable road test passed under the original conditions.",
    "Comparable retest was successful.",
    "Repair was verified under the recorded load.",
    "The original concern was resolved after the comparable retest.",
  ])("accepts only an unambiguous positive outcome: %s", (note) => {
    expect(classifyVerificationNote(note)).toBe("passed");
  });

  it.each([
    ["The original concern is not resolved.", "pending"],
    ["The comparable retest was not successful.", "pending"],
    ["Verification is not yet complete.", "pending"],
    ["The repair has not been verified.", "pending"],
    ["The repair hasn't been verified.", "pending"],
    ["The connectors haven't been verified.", "pending"],
    ["The result could not be verified.", "pending"],
    ["The result cannot be verified.", "pending"],
    ["The result can't be verified.", "pending"],
    ["The comparable road test never passed.", "failed"],
    ["The comparable road test did not pass.", "failed"],
    ["The comparable road test didn't pass.", "failed"],
    ["Road test failed.", "failed"],
    ["The original symptom recurred.", "failed"],
    ["The original symptom remains.", "failed"],
  ] as const)("never promotes a negated outcome: %s", (note, expected) => {
    expect(classifyVerificationNote(note)).toBe(expected);
    expect(classifyVerificationNote(note)).not.toBe("passed");
  });

  it.each([
    "Road test completed; result not stated.",
    "Technician recorded a quality-check note.",
    "The repair may have passed the retest.",
    "The connector appears resolved but no comparable retest is recorded.",
  ])("keeps unknown or qualified wording recorded-only: %s", (note) => {
    expect(classifyVerificationNote(note)).toBe("recorded");
  });

  it("keeps the verification claim gate closed from context through output policy", () => {
    const shaped = shapeDiagnosticsContext(
      source([
        "The concern is not resolved.",
        "The road test never passed.",
        "The repair can't be verified.",
      ]),
      {
        mode: "shop",
        workOrderId: "wo-1",
        jobId: "job-1",
        serverNowIso: recordedAt,
      }
    );

    expect(shaped.context.selectedJob?.verification.map((item) => item.result)).toEqual([
      "pending",
      "failed",
      "pending",
    ]);
    expect(shaped.claims.hasVerificationEvidence).toBe(false);
    expect(
      inspectDiagnosticsOutput(positiveVerificationDraft(), {
        mode: "shop",
        claims: shaped.claims,
      })
    ).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "VERIFICATION_CLAIM" })])
    );
  });
});
