import { describe, expect, it } from "vitest";
import {
  assertDiagnosticsOutputAllowed,
  inspectDiagnosticsOutput,
  renderDiagnosticsDraft,
} from "@/lib/diagnostics/outputPolicy";
import {
  diagnosticsResponseSchema,
  type DiagnosticsResponse,
} from "@/lib/diagnostics/responseSchema";

function validResponse(
  overrides: Partial<DiagnosticsResponse> = {}
): DiagnosticsResponse {
  return {
    phase: "information_needed",
    review_status: "staff_review_required",
    answer:
      "The no-crank concern is reported but the battery and starter circuit have not been tested.",
    assessments: [
      {
        conclusion: "Battery supply under load remains a possible cause.",
        confidence: "possible",
        evidence: ["A no-crank symptom was reported."],
        confirming_test:
          "Record battery voltage at the posts while the starter is commanded.",
      },
    ],
    requested_input: {
      type: "measurement",
      prompt: "Record battery voltage at the posts while the starter is commanded.",
      purpose: "Separate supply collapse from a downstream control fault.",
      tool_placement: "Across the battery posts with the meter set to DC volts.",
      conditions: "Bike secured, transmission neutral, starter commanded briefly.",
      units: "V DC",
    },
    next_step: "Record battery voltage at the posts while the starter is commanded.",
    safety: {
      stop_work: false,
      do_not_ride: false,
      boundary: "Keep the meter in voltage mode and clear of moving or hot components.",
    },
    sources: [
      {
        label: "General voltage-drop method",
        authority: "general_workshop_practice",
        status: "consulted",
        citation: "[General | workshop practice]",
        applies_to: "Test method only; no model-specific limit.",
      },
    ],
    source_summary:
      "No exact-model service manual or battery specification was supplied.",
    limitations: ["The motorcycle has not been measured by this assistant."],
    shop_log_entry: null,
    ...overrides,
  };
}

describe("diagnostics structured response", () => {
  it("accepts an evidence-labelled draft with one next input", () => {
    const parsed = diagnosticsResponseSchema.parse(validResponse());
    expect(inspectDiagnosticsOutput(parsed, { mode: "shop" })).toEqual([]);
  });

  it("requires a Shop Log Entry for report mode", () => {
    expect(inspectDiagnosticsOutput(validResponse(), { mode: "report" })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "REPORT_SHOP_LOG_MISSING" }),
      ])
    );
  });

  it.each([
    ["The motorcycle is roadworthy.", "ROADWORTHINESS_CLAIM"],
    ["The customer approved the repair.", "AUTHORIZATION_CLAIM"],
    ["We replaced the starter.", "COMPLETED_WORK_CLAIM"],
    ["According to the OEM manual, replace it.", "UNREAD_MANUAL_CLAIM"],
    ["Tighten the fastener to 42 N·m.", "UNSOURCED_TORQUE"],
    ["There are no open recalls.", "RECALL_STATUS_CLAIM"],
    ["Ontario law requires this part.", "ONTARIO_REQUIREMENT_CLAIM"],
    ["The estimate is $250.00.", "UNSUPPLIED_PRICE"],
  ])("withholds unsupported high-risk claim: %s", (answer, code) => {
    expect(inspectDiagnosticsOutput(validResponse({ answer }), { mode: "shop" })).toEqual(
      expect.arrayContaining([expect.objectContaining({ code })])
    );
  });

  it("does not call work verification-ready before work is recorded", () => {
    expect(
      inspectDiagnosticsOutput(
        validResponse({ phase: "ready_for_technician_verification" }),
        { mode: "shop" }
      )
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "WORK_NOT_RECORDED" }),
      ])
    );
  });

  it("keeps verification pending until an actual retest is supplied", () => {
    expect(
      inspectDiagnosticsOutput(
        validResponse({ answer: "The original complaint is resolved." }),
        {
          mode: "shop",
          claims: { hasRecordedCompletedWork: true },
        }
      )
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "VERIFICATION_CLAIM" }),
      ])
    );
  });

  it("permits a supported claim only when the service supplies its provenance", () => {
    expect(() =>
      assertDiagnosticsOutputAllowed(
        validResponse({ answer: "The customer approved the diagnostic test." }),
        {
          mode: "advisor",
          claims: { hasRecordedCustomerAuthorization: true },
        }
      )
    ).not.toThrow();
  });

  it("renders the review warning and exactly one NEXT STEP heading", () => {
    const rendered = renderDiagnosticsDraft(validResponse());
    expect(rendered).toContain("AI draft — staff review required");
    expect(rendered.match(/\*\*NEXT STEP:\*\*/g)).toHaveLength(1);
  });
});
