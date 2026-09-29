import { describe, expect, it } from "vitest";
import {
  inspectDiagnosticsOutput,
  renderDiagnosticsDraft,
} from "@/lib/diagnostics/outputPolicy";
import type { DiagnosticsResponse } from "@/lib/diagnostics/responseSchema";

function response(overrides: Partial<DiagnosticsResponse> = {}): DiagnosticsResponse {
  return {
    phase: "information_needed",
    review_status: "staff_review_required",
    answer: "A measurement is needed.",
    assessments: [
      {
        conclusion: "Supply remains possible.",
        confidence: "possible",
        evidence: ["No measurement is recorded."],
        confirming_test: "Measure battery voltage.",
      },
    ],
    requested_input: {
      type: "measurement",
      prompt: "Measure battery voltage at the posts.",
      purpose: "Assess supply.",
      tool_placement: "Battery posts.",
      conditions: "Starter requested.",
      units: "V",
    },
    next_step: "Measure battery voltage at the posts.",
    safety: { stop_work: false, do_not_ride: false, boundary: null },
    sources: [],
    source_summary: "No exact-model source supplied.",
    limitations: ["Remote draft."],
    shop_log_entry: null,
    ...overrides,
  };
}

describe("diagnostics output hardening", () => {
  it.each([
    {
      source: {
        label: "OEM manual",
        authority: "official_oem",
        status: "consulted",
        citation: "p. 1",
        applies_to: "motorcycle",
      },
      code: "SOURCE_EXACT_MODEL_UNAVAILABLE",
    },
    {
      source: {
        label: "Current official recall lookup",
        authority: "regulatory",
        status: "consulted",
        citation: "lookup",
        applies_to: "recalls",
      },
      code: "SOURCE_RECALL_UNAVAILABLE",
    },
    {
      source: {
        label: "Unverified app catalogue",
        authority: "unverified",
        status: "consulted",
        citation: null,
        applies_to: "parts",
      },
      code: "UNVERIFIED_SOURCE_CONSULTED",
    },
    {
      source: {
        label: "OTOMOTO Universal Diagnostic Tree 2026",
        authority: "provided_reference",
        status: "consulted",
        citation: null,
        applies_to: "diagnosis",
      },
      code: "NAMED_SOURCE_UNAVAILABLE",
    },
  ] as const)("validates structured source provenance", ({ source, code }) => {
    expect(
      inspectDiagnosticsOutput(response({ sources: [source] }), {
        mode: "shop",
      })
    ).toEqual(expect.arrayContaining([expect.objectContaining({ code })]));
  });

  it("allows regulatory consulted status only for the matching supplied source", () => {
    const output = response({
      sources: [
        {
          label: "Current official Ontario inspection standard",
          authority: "regulatory",
          status: "consulted",
          citation: "Official current extract",
          applies_to: "Ontario inspection",
        },
      ],
    });
    expect(
      inspectDiagnosticsOutput(output, {
        mode: "report",
        claims: {
          hasCurrentOntarioInspectionSource: true,
          hasCurrentRecallSource: false,
        },
      })
    ).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "SOURCE_REGULATORY_UNAVAILABLE" }),
      ])
    );
  });

  it.each([
    ["The bike is now safe.", "ROADWORTHINESS_CLAIM"],
    ["It's safe to ride.", "ROADWORTHINESS_CLAIM"],
    ["The motorcycle is OK to ride.", "ROADWORTHINESS_CLAIM"],
    ["The repair was approved by the customer.", "AUTHORIZATION_CLAIM"],
    ["Authorization has been confirmed.", "AUTHORIZATION_CLAIM"],
    ["Starter replaced and wiring repaired.", "COMPLETED_WORK_CLAIM"],
    ["Replaced the starter.", "COMPLETED_WORK_CLAIM"],
    ["Repair completed.", "COMPLETED_WORK_CLAIM"],
    ["Verification passed; complaint resolved.", "VERIFICATION_CLAIM"],
  ])("catches broader unsupported positive claim: %s", (answer, code) => {
    expect(inspectDiagnosticsOutput(response({ answer }), { mode: "shop" })).toEqual(
      expect.arrayContaining([expect.objectContaining({ code })])
    );
  });

  it("checks unsafe claims inside the shop log", () => {
    const output = response({
      shop_log_entry: {
        date_time: null,
        bike_or_ro: "TOR-1001",
        complaint: "No crank",
        tests_and_conditions: "None",
        results_and_units: "None",
        conclusions_and_confidence: "Possible",
        repairs_performed: "Starter replaced.",
        verification: "Complaint resolved.",
        authorization: "Repair was approved.",
        open_items: "None",
      },
    });
    const violations = inspectDiagnosticsOutput(output, { mode: "report" });
    expect(violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "AUTHORIZATION_CLAIM" }),
        expect.objectContaining({ code: "COMPLETED_WORK_CLAIM" }),
        expect.objectContaining({ code: "VERIFICATION_CLAIM" }),
      ])
    );
  });

  it("matches unavailable named resources with filename separators", () => {
    const output = response({
      sources: [
        {
          label: "OTOMOTO_Universal_Diagnostic_Tree_2026.docx",
          authority: "provided_reference",
          status: "consulted",
          citation: null,
          applies_to: "diagnosis",
        },
      ],
    });
    expect(inspectDiagnosticsOutput(output, { mode: "shop" })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "NAMED_SOURCE_UNAVAILABLE" }),
      ])
    );
    expect(
      inspectDiagnosticsOutput(output, {
        mode: "shop",
        claims: { availableNamedReferences: ["universalDiagnosticTree"] },
      })
    ).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "NAMED_SOURCE_UNAVAILABLE" }),
      ])
    );
  });

  it("does not flag clear warnings, negations, or unrelated certification", () => {
    const output = response({
      answer:
        'The motorcycle is not safe to ride. Never claim "the bike is roadworthy." The technician is certified.',
    });
    expect(inspectDiagnosticsOutput(output, { mode: "shop" })).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "ROADWORTHINESS_CLAIM" })])
    );
  });

  it.each([
    ["Use 42 N·m.", "42:nm"],
    ["Set 36 psi.", "36:psi"],
    ["Use 0.15 mm clearance.", "0.15:mm"],
    ["Capacity is 3.2 L.", "3.2:l"],
    ["Expect 12.6 V and 0.4 Ω.", "12.6:v"],
    ["Current should be 4 A.", "4:a"],
  ])("allows only exact normalized supplied technical values", (answer, allowed) => {
    expect(
      inspectDiagnosticsOutput(response({ answer }), {
        mode: "shop",
        claims: { allowedTechnicalValues: [allowed, "0.4:ohm"] },
      })
    ).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "UNSOURCED_TECHNICAL_VALUE" }),
      ])
    );

    expect(
      inspectDiagnosticsOutput(
        response({ answer: answer.replace(/\d+(?:\.\d+)?/, "99") }),
        {
          mode: "shop",
          claims: { allowedTechnicalValues: [allowed] },
        }
      )
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "UNSOURCED_TECHNICAL_VALUE" }),
      ])
    );
  });

  it.each(["$186.45", "CAD 186.45", "186.45 dollars", "USD 186.45"])(
    "matches each currency amount to stored cents: %s",
    (amount) => {
      expect(
        inspectDiagnosticsOutput(response({ answer: `Total: ${amount}.` }), {
          mode: "advisor",
          claims: { allowedPriceCents: [18_645] },
        })
      ).not.toEqual(
        expect.arrayContaining([expect.objectContaining({ code: "UNSUPPLIED_PRICE" })])
      );
      expect(
        inspectDiagnosticsOutput(response({ answer: "Total: $186.46." }), {
          mode: "advisor",
          claims: { allowedPriceCents: [18_645] },
        })
      ).toEqual(
        expect.arrayContaining([expect.objectContaining({ code: "UNSUPPLIED_PRICE" })])
      );
    }
  );

  it.each([
    "1) Measure voltage. 2) Inspect the relay.",
    "Measure voltage; inspect the relay.",
    "Measure voltage and then replace the relay.",
  ])("rejects inline or sequenced multiple next actions: %s", (next_step) => {
    expect(inspectDiagnosticsOutput(response({ next_step }), { mode: "shop" })).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "MULTIPLE_NEXT_STEPS" })])
    );
  });

  it("requires reasonable correspondence between requested input and next step", () => {
    expect(
      inspectDiagnosticsOutput(
        response({ next_step: "Photograph the rear brake rotor." }),
        { mode: "shop" }
      )
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "NEXT_STEP_INPUT_MISMATCH" }),
      ])
    );
  });

  it("rejects multiple actions hidden in the requested-input prompt", () => {
    const output = response({
      requested_input: {
        ...response().requested_input,
        prompt: "1) Measure voltage. 2) Replace the relay.",
      },
    });
    expect(inspectDiagnosticsOutput(output, { mode: "shop" })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "MULTIPLE_REQUESTED_INPUTS" }),
      ])
    );
  });

  it("renders mandatory safety first and keeps all required sections", () => {
    const output = response({
      safety: {
        stop_work: true,
        do_not_ride: true,
        boundary: "Stop work and do not ride.",
      },
      sources: [
        {
          label: "General workshop practice",
          authority: "general_workshop_practice",
          status: "consulted",
          citation: null,
          applies_to: "test method",
        },
      ],
    });
    const rendered = renderDiagnosticsDraft(output);

    expect(rendered.startsWith("**SAFETY — STOP WORK / DO NOT RIDE:**")).toBe(true);
    expect(rendered).toContain("**Assessments:**");
    expect(rendered).toContain("**Sources/status:**");
    expect(rendered).toContain("**Limitations:**");
    expect(rendered.match(/\*\*NEXT STEP:\*\*/g)).toHaveLength(1);
  });
});
