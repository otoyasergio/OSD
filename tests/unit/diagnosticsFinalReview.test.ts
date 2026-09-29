import { describe, expect, it } from "vitest";
import {
  shapeDiagnosticsContext,
  type DiagnosticsContextSource,
} from "@/lib/diagnostics/context";
import { inspectDiagnosticsOutput } from "@/lib/diagnostics/outputPolicy";
import { buildDiagnosticsInstructions } from "@/lib/diagnostics/prompts";
import type { DiagnosticsResponse } from "@/lib/diagnostics/responseSchema";

function draft(answer: string): DiagnosticsResponse {
  return {
    phase: "information_needed",
    review_status: "staff_review_required",
    answer,
    assessments: [],
    requested_input: {
      type: "measurement",
      prompt: "Measure battery voltage at the posts.",
      purpose: "Assess supply.",
      tool_placement: "Battery posts.",
      conditions: "Starter requested.",
      units: "volts",
    },
    next_step: "Measure battery voltage at the posts.",
    safety: { stop_work: false, do_not_ride: false, boundary: null },
    sources: [],
    source_summary: "No source supplied.",
    limitations: [],
    shop_log_entry: null,
  };
}

function codes(
  answer: string,
  claims: Parameters<typeof inspectDiagnosticsOutput>[1]["claims"] = {}
): string[] {
  return inspectDiagnosticsOutput(draft(answer), {
    mode: "shop",
    claims,
  }).map((violation) => violation.code);
}

function shopLogCodes(
  overrides: Partial<NonNullable<DiagnosticsResponse["shop_log_entry"]>>,
  claims: Parameters<typeof inspectDiagnosticsOutput>[1]["claims"] = {}
): string[] {
  const output = draft("Shop log draft.");
  output.shop_log_entry = {
    date_time: null,
    bike_or_ro: "TOR-1001",
    complaint: "No crank",
    tests_and_conditions: "Not supplied",
    results_and_units: "Not supplied",
    conclusions_and_confidence: "Not supplied",
    repairs_performed: "None",
    verification: "None",
    authorization: "Not supplied",
    open_items: "Pending",
    ...overrides,
  };
  return inspectDiagnosticsOutput(output, { mode: "report", claims }).map(
    (violation) => violation.code
  );
}

function source(): DiagnosticsContextSource {
  return {
    workOrder: {
      workOrderId: "wo-1",
      workOrderNumber: "TOR-1001",
      status: "in_progress",
      complaint: "Measured battery voltage was 12.4 volts.",
      internalNotes: "Recorded current was 3.1 amps.",
    },
    motorcycle: {
      year: 2022,
      make: "Honda",
      model: "CB500F",
      notes: "Al Stone reported an alternator noise. Al and Stone heard it first.",
    },
    jobs: [
      {
        jobId: "job-1",
        workOrderId: "wo-1",
        origin: "customer_request",
        serviceName: "Diagnosis",
        status: "in_progress",
        notes: "Observed tire pressure was 28 psi.",
        parts: [],
        checklist: [],
        verification: [],
      },
    ],
    technicianNotes: [],
    recommendations: [
      {
        recommendationId: "rec-1",
        workOrderId: "wo-1",
        jobId: "job-1",
        description: "Inspect charging wiring.",
        severity: "future_attention",
        status: "pending",
        notes: "The recorded resistance was 0.4 ohms.",
      },
    ],
    checks: { quality: [], safety: [] },
    references: {},
  };
}

describe("final diagnostics review regressions", () => {
  it.each([
    "The regulator may be replaced.",
    "The regulator might be repaired.",
    "The regulator could be installed.",
    "The regulator should be replaced.",
    "The regulator would be repaired.",
    "The regulator will be installed.",
    "The regulator needs to be replaced.",
    "The regulator may have been replaced.",
    "I recommend the battery be replaced.",
    "I suggest the connector be repaired.",
    "The stator is recommended to be replaced.",
    "Recommendation: stator replaced.",
    "The customer installed an aftermarket exhaust.",
    "The owner replaced the battery.",
    "The previous owner repaired the wiring.",
    "Previous owner: stator replaced.",
    "Aftermarket history: new battery installed.",
    "An aftermarket alarm was installed by the previous owner.",
    "Which battery is installed?",
    "Is caliper fixed or floating?",
    "Record part number of regulator installed under seat.",
    "Battery installed under seat.",
    "Regulator installed on left side.",
    "Sensor installed in the tail.",
    "Module installed at the rear.",
    "Caliper fixed or floating.",
    "Installed state is unknown.",
    "Fixed range selection is available.",
  ])("does not treat proposed or historical work as completed: %s", (answer) => {
    expect(codes(answer)).not.toContain("COMPLETED_WORK_CLAIM");
  });

  it.each([
    "We replaced the battery.",
    "The technician repaired the wiring.",
    "The shop installed the relay.",
    "We fixed the connector.",
    "The battery was replaced.",
    "Both calipers were repaired.",
    "The relay has been installed.",
    "The connectors have been fixed.",
    "Replaced the battery.",
    "Installed the relay.",
    "Repaired the harness.",
    "Fixed the connector.",
    "Stator replaced.",
    "New battery installed.",
    "Fuel pump installed.",
    "Repair is complete.",
    "Work was completed.",
    "Job has been completed.",
    "We completed the repair.",
    "Due to low output, the stator was replaced.",
    "Returned to the bench; stator replaced.",
  ])("flags only explicit completed-work forms: %s", (answer) => {
    expect(codes(answer)).toContain("COMPLETED_WORK_CLAIM");
  });

  it.each([
    "The bike is safe.",
    "It is safe to probe the connector.",
    "Use a safe test point.",
    "Keep the meter in a safe range.",
  ])("permits procedural safe language: %s", (answer) => {
    expect(codes(answer)).not.toContain("ROADWORTHINESS_CLAIM");
  });

  it.each([
    "The bike is safe to ride.",
    "The motorcycle is safe to operate.",
    "This vehicle is safe to use.",
    "CB500F is safe to ride.",
    "Ninja 650 is okay to operate.",
    "Safe to ride.",
    "OK to operate.",
    "The Ducati is roadworthy.",
  ])("flags actual roadworthiness language: %s", (answer) => {
    expect(codes(answer)).toContain("ROADWORTHINESS_CLAIM");
  });

  it.each([
    "If the CB500F is safe to ride, record the technician's decision.",
    "Once safe to ride, the technician may record a decision.",
    "Safe to probe the connector.",
    "Safe to test at the battery posts.",
  ])("preserves conditional and procedural safety exemptions: %s", (answer) => {
    expect(codes(answer)).not.toContain("ROADWORTHINESS_CLAIM");
  });

  it("flags generic recorded verification after repair, but permits future checks", () => {
    expect(codes("Charging system verified after repair.")).toContain(
      "VERIFICATION_CLAIM"
    );
    for (const instruction of [
      "Retest to confirm the charging system is verified.",
      "The charging system will be verified after repair.",
      "The charging system should be verified after repair.",
      "Once the charging system is verified, record the result.",
    ]) {
      expect(codes(instruction)).not.toContain("VERIFICATION_CLAIM");
    }
  });

  it("redacts full names and name tokens at boundaries without corrupting words", () => {
    const result = shapeDiagnosticsContext(source(), {
      mode: "shop",
      workOrderId: "wo-1",
      jobId: "job-1",
      redactTerms: { customerName: "Al Stone" },
    });
    const notes = result.context.motorcycle.notes;

    expect(notes).not.toContain("Al Stone");
    expect(notes).not.toMatch(/\bStone\b/);
    expect(notes).toContain("alternator");
    expect(notes).toContain("Al");
  });

  it("allows included complaint and note readings only as measured findings", () => {
    const claims = shapeDiagnosticsContext(source(), {
      mode: "shop",
      workOrderId: "wo-1",
      jobId: "job-1",
    }).claims;

    expect(claims.allowedMeasuredValues).toEqual(
      expect.arrayContaining(["12.4:v", "3.1:a", "28:psi", "0.4:ohm"])
    );
    expect(claims.allowedSpecificationValues).not.toEqual(
      expect.arrayContaining(["12.4:v", "3.1:a", "28:psi", "0.4:ohm"])
    );
  });

  it("ignores general percentages but gates percentage specifications and readings", () => {
    expect(codes("Confidence is 90 percent.")).not.toContain("UNSOURCED_TECHNICAL_VALUE");
    expect(codes("Confidence is 90%.")).not.toContain("UNSOURCED_TECHNICAL_VALUE");
    expect(codes("The mixture specification is 50 percent.")).toContain(
      "UNSOURCED_TECHNICAL_VALUE"
    );
    expect(codes("The setpoint is 50%.")).toContain("UNSOURCED_TECHNICAL_VALUE");
    expect(
      codes("The measured duty cycle was 60 percent.", {
        allowedMeasuredValues: ["60:percent"],
        allowedSpecificationValues: [],
      })
    ).not.toContain("UNSOURCED_TECHNICAL_VALUE");
  });

  it.each([
    "None",
    "No",
    "Not performed",
    "Not recorded",
    "Not supplied",
    "Not completed",
    "None recorded",
    "No repairs performed",
    "No work was completed",
    "Repairs not recorded",
    "Work was not supplied",
    "Pending",
    "Not recorded — awaiting diagnosis",
    "None: awaiting diagnosis",
    "No repairs performed (estimate pending)",
  ])("accepts explicit no-completed-work Shop Log value: %s", (repairs_performed) => {
    expect(shopLogCodes({ repairs_performed })).not.toContain("COMPLETED_WORK_CLAIM");
  });

  it.each([
    "None",
    "No",
    "Not verified",
    "Not recorded",
    "None recorded",
    "Pending",
    "Pending retest",
    "Not supplied",
    "Not performed",
    "Verification not recorded",
    "No verification performed",
    "Not verified — pending retest",
    "None (retest pending)",
  ])("accepts explicit no-verification Shop Log value: %s", (verification) => {
    expect(shopLogCodes({ verification })).not.toContain("VERIFICATION_CLAIM");
  });

  it("withholds terse positive or ambiguous Shop Log claims without records", () => {
    expect(shopLogCodes({ repairs_performed: "Stator replaced." })).toContain(
      "COMPLETED_WORK_CLAIM"
    );
    expect(shopLogCodes({ repairs_performed: "No entry." })).toContain(
      "COMPLETED_WORK_CLAIM"
    );
    expect(shopLogCodes({ verification: "Charging verified." })).toContain(
      "VERIFICATION_CLAIM"
    );
    expect(shopLogCodes({ verification: "No entry." })).toContain("VERIFICATION_CLAIM");
    expect(shopLogCodes({ repairs_performed: "None — stator replaced." })).toContain(
      "COMPLETED_WORK_CLAIM"
    );
    expect(
      shopLogCodes({ repairs_performed: "Not recorded (work completed)." })
    ).toContain("COMPLETED_WORK_CLAIM");
    expect(shopLogCodes({ verification: "Not recorded — charging verified." })).toContain(
      "VERIFICATION_CLAIM"
    );
  });

  it("permits positive Shop Log entries only with matching recorded evidence", () => {
    const result = shopLogCodes(
      {
        repairs_performed: "Stator replaced.",
        verification: "Charging verified.",
      },
      {
        hasRecordedCompletedWork: true,
        hasVerificationEvidence: true,
      }
    );
    expect(result).not.toContain("COMPLETED_WORK_CLAIM");
    expect(result).not.toContain("VERIFICATION_CLAIM");
  });

  it("prompts explicit absent Shop Log work and verification values", () => {
    const prompt = buildDiagnosticsInstructions("report");
    expect(prompt).toContain("repairs_performed: Not recorded");
    expect(prompt).toContain("verification: Not verified");
  });
});
