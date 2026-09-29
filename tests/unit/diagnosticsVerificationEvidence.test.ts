import { describe, expect, it } from "vitest";
import {
  shapeDiagnosticsContext,
  type DiagnosticsContextSource,
} from "@/lib/diagnostics/context";
import { inspectDiagnosticsOutput } from "@/lib/diagnostics/outputPolicy";
import type { DiagnosticsResponse } from "@/lib/diagnostics/responseSchema";
import { classifyVerificationNote } from "@/lib/services/diagnosticsAssistant";

const recordedAt = "2026-09-29T09:00:00.000Z";

function source(
  notes: Array<string | { note: string; recordedAt: string }>
): DiagnosticsContextSource {
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
        verification: notes.map((entry, index) => ({
          verificationId: `verification-${index}`,
          result: classifyVerificationNote(
            typeof entry === "string" ? entry : entry.note
          ),
          notes: typeof entry === "string" ? entry : entry.note,
          recordedAt: typeof entry === "string" ? recordedAt : entry.recordedAt,
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
    "Test ride passed.",
    "QC passed.",
    "Passed QC.",
    "Repair was verified under the recorded load.",
    "Fix verified.",
    "Verified the repair.",
    "The original concern was resolved after the comparable retest.",
    "The customer complaint is resolved.",
    "The symptom is no longer present.",
    "The symptom has not recurred after a 25 km road test.",
    "No failure codes; road test passed.",
    "Road test passed; noise not present.",
    "Mostly highway road test; passed.",
    "Road test passed, noise not present.",
    "Mostly highway road test, passed.",
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
    ["The concern is still present after the repair.", "failed"],
    ["The noise persists after the road test.", "failed"],
    ["The leak remains visible.", "failed"],
    ["The repair is partially successful.", "failed"],
    ["The concern is partly resolved.", "failed"],
    ["The symptom is mostly resolved.", "failed"],
    ["The concern is not completely resolved.", "failed"],
    ["The road test hasn't passed.", "failed"],
    ["The quality check haven't passed.", "failed"],
    ["The test ride wasn't successful.", "pending"],
    ["The repair couldn't be verified.", "pending"],
    ["The repair was not fully verified after the road test.", "pending"],
    ["The repair was verified without a comparable road test.", "pending"],
    ["Passed QC without a comparable retest.", "pending"],
    ["Concern is no longer present without a road test.", "pending"],
    [
      "Symptom has not recurred after a 25 km road test without comparable load.",
      "pending",
    ],
    ["Unable to verify the fix.", "pending"],
    ["Repair isn't verified yet.", "pending"],
    ["Retest isn't successful.", "pending"],
    ["Concern isn't resolved.", "pending"],
    ["Road test won't be successful until relay arrives.", "pending"],
    ["No verified fix yet.", "pending"],
    ["Repair needed; concern verified.", "pending"],
    ["Complaint to be resolved.", "pending"],
    ["Road test must be successful.", "pending"],
    ["Road test passed.\nThe concern remains.", "failed"],
  ] as const)("never promotes a negated outcome: %s", (note, expected) => {
    expect(classifyVerificationNote(note)).toBe(expected);
    expect(classifyVerificationNote(note)).not.toBe("passed");
  });

  it.each([
    "Road test completed; result not stated.",
    "Road test successful.",
    "Road test is successful.",
    "QC is successful.",
    "Technician recorded a quality-check note.",
    "The repair may have passed the retest.",
    "The connector appears resolved but no comparable retest is recorded.",
    "Verified the concern is present.",
    "Verified the noise is present.",
    "Verified the leak is present.",
    "Verified the fault is present.",
    "Verified the code is present.",
    "Verified battery voltage at the terminals.",
    "The diagnosis was successful.",
    "Successfully reproduced clunk.",
    "Quality check was successful.",
    "Symptom has not recurred.",
    "Symptom has not recurred after a 25 km test ride.",
    "No road test; passed.",
    "Road test should pass once the relay arrives.",
    "Recommend road test after repair.",
    "Concern reproduced before repair.",
    "Comparable retest to follow.",
    "Road test will be completed after repair.",
  ])("keeps unknown or qualified wording recorded-only: %s", (note) => {
    expect(classifyVerificationNote(note)).toBe("recorded");
  });

  it.each([
    "Verified leak present.",
    "Verified concern present.",
    "Verified noise present.",
    "Verified fault present.",
  ])("keeps diagnostic confirmation non-passing: %s", (note) => {
    expect(classifyVerificationNote(note)).toBe("recorded");
  });

  it("keeps partial and negated verification gates closed through output policy", () => {
    const shaped = shapeDiagnosticsContext(
      source([
        "The concern is partly resolved.",
        "The symptom is mostly resolved and remains present.",
        "The repair was not completely verified after the road test.",
      ]),
      {
        mode: "shop",
        workOrderId: "wo-1",
        jobId: "job-1",
        serverNowIso: recordedAt,
      }
    );

    expect(shaped.context.selectedJob?.verification.map((item) => item.result)).toEqual([
      "failed",
      "failed",
      "failed",
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

  it.each([
    ["failure", "Road test failed.", false],
    ["residual", "The concern remains.", false],
    ["negation", "Repair isn't verified yet.", false],
    ["diagnostic confirmation", "Verified leak present.", false],
    ["future work", "Complaint to be resolved.", false],
    ["bare no-recurrence", "Symptom has not recurred.", false],
    ["explicit post-repair outcome", "Road test passed.", true],
  ] as const)(
    "carries %s classification through context claims and output policy",
    (_className, note, expectedEvidence) => {
      const shaped = shapeDiagnosticsContext(source([note]), {
        mode: "shop",
        workOrderId: "wo-1",
        jobId: "job-1",
        serverNowIso: recordedAt,
      });
      const violations = inspectDiagnosticsOutput(positiveVerificationDraft(), {
        mode: "shop",
        claims: shaped.claims,
      });

      expect(shaped.claims.hasVerificationEvidence).toBe(expectedEvidence);
      expect(
        violations.some((violation) => violation.code === "VERIFICATION_CLAIM")
      ).toBe(!expectedEvidence);
    }
  );

  it("lets a newer failed note close the gate after an older pass", () => {
    const shaped = shapeDiagnosticsContext(
      source([
        {
          note: "Road test passed.",
          recordedAt: "2026-09-29T08:00:00.000Z",
        },
        {
          note: "The symptom remains present.",
          recordedAt: "2026-09-29T09:00:00.000Z",
        },
      ]),
      {
        mode: "shop",
        workOrderId: "wo-1",
        jobId: "job-1",
        serverNowIso: recordedAt,
      }
    );

    expect(shaped.context.selectedJob?.verification.map((item) => item.result)).toEqual([
      "failed",
      "passed",
    ]);
    expect(shaped.claims.hasVerificationEvidence).toBe(false);
  });

  it("lets a newer explicit pass open the gate after an older failure", () => {
    const shaped = shapeDiagnosticsContext(
      source([
        {
          note: "Road test failed.",
          recordedAt: "2026-09-29T08:00:00.000Z",
        },
        {
          note: "Comparable road test passed.",
          recordedAt: "2026-09-29T09:00:00.000Z",
        },
      ]),
      {
        mode: "shop",
        workOrderId: "wo-1",
        jobId: "job-1",
        serverNowIso: recordedAt,
      }
    );

    expect(shaped.context.selectedJob?.verification.map((item) => item.result)).toEqual([
      "passed",
      "failed",
    ]);
    expect(shaped.claims.hasVerificationEvidence).toBe(true);
  });
});
