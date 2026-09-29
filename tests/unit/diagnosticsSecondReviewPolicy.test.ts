import { describe, expect, it } from "vitest";
import {
  inspectDiagnosticsOutput,
  renderDiagnosticsDraft,
} from "@/lib/diagnostics/outputPolicy";
import type { DiagnosticsResponse } from "@/lib/diagnostics/responseSchema";

function draft(overrides: Partial<DiagnosticsResponse> = {}): DiagnosticsResponse {
  return {
    phase: "information_needed",
    review_status: "staff_review_required",
    answer: "A measurement is needed.",
    assessments: [],
    requested_input: {
      type: "measurement",
      prompt: "Record battery voltage at the posts.",
      purpose: "Assess supply.",
      tool_placement: "Battery posts.",
      conditions: "Starter requested.",
      units: "volts",
    },
    next_step: "Use the multimeter to obtain electrical potential at both terminals.",
    safety: { stop_work: false, do_not_ride: false, boundary: null },
    sources: [],
    source_summary: "No source supplied.",
    limitations: [],
    shop_log_entry: null,
    ...overrides,
  };
}

function codes(
  output: DiagnosticsResponse,
  claims: Parameters<typeof inspectDiagnosticsOutput>[1]["claims"] = {}
) {
  return inspectDiagnosticsOutput(output, { mode: "shop", claims }).map(
    (item) => item.code
  );
}

describe("second review output-policy regressions", () => {
  it.each([
    ["Don't worry, the bike is safe to ride.", "ROADWORTHINESS_CLAIM"],
    ["The 2021 Ninja ZX-6R is roadworthy.", "ROADWORTHINESS_CLAIM"],
    ["This Ducati passed the safety inspection.", "ROADWORTHINESS_CLAIM"],
    ["The motorcycle is cleared for release.", "ROADWORTHINESS_CLAIM"],
    ["The bike is ready for pickup.", "ROADWORTHINESS_CLAIM"],
    ["The customer authorized the repair.", "AUTHORIZATION_CLAIM"],
    ["The customer gave approval.", "AUTHORIZATION_CLAIM"],
    ["Approval was received.", "AUTHORIZATION_CLAIM"],
    ["Fuel pump installed.", "COMPLETED_WORK_CLAIM"],
    ["Repaired the charging circuit.", "COMPLETED_WORK_CLAIM"],
    ["Fixed the loose connector.", "COMPLETED_WORK_CLAIM"],
    ["The charging system was verified.", "VERIFICATION_CLAIM"],
  ])("blocks reviewer positive claim: %s", (answer, expected) => {
    expect(codes(draft({ answer }))).toContain(expected);
  });

  it.each([
    "Retest to confirm the charging system is verified.",
    "Once the repair is verified, record the result.",
    "After the bike is safe to ride, document the technician's decision.",
    "Before the motorcycle is cleared for release, complete the real checks.",
    "If the repair is verified, record who performed the retest.",
    "Check whether the bike is roadworthy; do not assume it is.",
    "Until the system is verified, keep the job open.",
    "When the customer gives approval, staff may update the job.",
    "The technician is certified.",
  ])("permits instruction, conditional, or unrelated statement: %s", (answer) => {
    expect(codes(draft({ answer }))).not.toEqual(
      expect.arrayContaining([
        "ROADWORTHINESS_CLAIM",
        "AUTHORIZATION_CLAIM",
        "COMPLETED_WORK_CLAIM",
        "VERIFICATION_CLAIM",
      ])
    );
  });

  it.each([
    ["1,000 rpm", "1000:rpm"],
    ["12.6 volts", "12.6:v"],
    ["4 amps", "4:a"],
    ["0.4 ohms", "0.4:ohm"],
    ["0.15 millimetres", "0.15:mm"],
    ["42 newton-metres", "42:nm"],
    ["2,000 kilometres", "2000:km"],
    ["180 °F", "180:f"],
    ["90 percent", "90:percent"],
    ["250 kilopascals", "250:kpa"],
    ["3.2 litres", "3.2:l"],
  ])("normalizes reviewer technical value %s", (value, normalized) => {
    expect(
      codes(draft({ answer: `Specified limit: ${value}.` }), {
        allowedSpecificationValues: [normalized],
      })
    ).not.toContain("UNSOURCED_TECHNICAL_VALUE");
  });

  it("distinguishes measured findings from sourced specifications", () => {
    const claims = {
      allowedMeasuredValues: ["12.6:v"],
      allowedSpecificationValues: [],
    };
    expect(
      codes(draft({ answer: "The recorded measurement was 12.6 volts." }), claims)
    ).not.toContain("UNSOURCED_TECHNICAL_VALUE");
    expect(
      codes(draft({ answer: "The battery limit is 12.6 volts." }), claims)
    ).toContain("UNSOURCED_TECHNICAL_VALUE");
    expect(
      codes(draft({ answer: "Set the battery threshold to 12.6 volts." }), {
        allowedSpecificationValues: ["12.6:v"],
      })
    ).not.toContain("UNSOURCED_TECHNICAL_VALUE");
  });

  it.each([
    "Use a 10 mm socket.",
    "Use a 10 millimetre Allen key.",
    "Use the 5 mm hex bit.",
    "Photo 1 shows the connector; photo 2 shows the relay.",
    "Use an A key and an L bracket.",
  ])("exempts tool sizes, photo ordinals, and ambiguous units: %s", (answer) => {
    expect(codes(draft({ answer }))).not.toContain("UNSOURCED_TECHNICAL_VALUE");
  });

  it.each([
    {
      label: "Factory wiring diagram",
      citation: "OEM service manual p. 12",
      authority: "general_workshop_practice" as const,
      expected: "SOURCE_EXACT_MODEL_UNAVAILABLE",
    },
    {
      label: "TSB 24-01",
      citation: "Technical service bulletin",
      authority: "provided_reference" as const,
      expected: "SOURCE_EXACT_MODEL_UNAVAILABLE",
    },
    {
      label: "Transport recall lookup",
      citation: "Official recall portal",
      authority: "provided_reference" as const,
      expected: "SOURCE_RECALL_UNAVAILABLE",
    },
    {
      label: "Ontario requirements",
      citation: "O. Reg. 611",
      authority: "provided_reference" as const,
      expected: "SOURCE_REGULATORY_UNAVAILABLE",
    },
  ])(
    "classifies source text independently of authority: $label",
    ({ label, citation, authority, expected }) => {
      expect(
        codes(
          draft({
            sources: [
              {
                label,
                citation,
                authority,
                status: "consulted",
                applies_to: "diagnosis",
              },
            ],
          })
        )
      ).toContain(expected);
    }
  );

  it("requires included evidence for consulted provided references", () => {
    const output = draft({
      sources: [
        {
          label: "Technician supplied test sheet",
          citation: "Sheet A",
          authority: "provided_reference",
          status: "consulted",
          applies_to: "charging test",
        },
      ],
    });
    expect(codes(output)).toContain("SOURCE_REFERENCE_UNAVAILABLE");
    expect(
      codes(output, {
        hasProvidedReferenceEvidence: true,
        includedReferenceEvidence: ["Technician supplied test sheet Sheet A"],
      })
    ).not.toContain("SOURCE_REFERENCE_UNAVAILABLE");
  });

  it("recognizes 'per the service manual' as an exact-source claim", () => {
    expect(codes(draft({ answer: "Per the service manual, use this limit." }))).toContain(
      "UNREAD_MANUAL_CLAIM"
    );
  });

  it("accepts suffix currency only when exact stored cents are allowed", () => {
    expect(
      codes(draft({ answer: "The stored total is 120 CAD." }), {
        allowedPriceCents: [12_000],
      })
    ).not.toContain("UNSUPPLIED_PRICE");
    expect(
      codes(draft({ answer: "The stored total is 121 CAD." }), {
        allowedPriceCents: [12_000],
      })
    ).toContain("UNSUPPLIED_PRICE");
  });

  it("renders source authority, status, and citation", () => {
    const rendered = renderDiagnosticsDraft(
      draft({
        sources: [
          {
            label: "Provided sheet",
            authority: "provided_reference",
            status: "provided_not_verified",
            citation: "Sheet A",
            applies_to: "test",
          },
        ],
      })
    );
    expect(rendered).toContain(
      "Provided sheet — provided_reference — provided_not_verified — Sheet A"
    );
  });

  it("matches paraphrased requested input without accepting another evidence type", () => {
    expect(codes(draft())).not.toContain("NEXT_STEP_INPUT_MISMATCH");
    expect(
      codes(
        draft({
          next_step: "Photograph the rear brake rotor.",
        })
      )
    ).toContain("NEXT_STEP_INPUT_MISMATCH");
  });
});
