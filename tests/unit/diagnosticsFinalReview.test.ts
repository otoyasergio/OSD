import { describe, expect, it } from "vitest";
import {
  shapeDiagnosticsContext,
  type DiagnosticsContextSource,
} from "@/lib/diagnostics/context";
import { inspectDiagnosticsOutput } from "@/lib/diagnostics/outputPolicy";
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
    "I recommend the battery be replaced.",
    "I suggest the connector be repaired.",
    "The customer installed an aftermarket exhaust.",
    "The owner replaced the battery.",
    "The previous owner repaired the wiring.",
    "An aftermarket alarm was installed by the previous owner.",
    "Fixed range selection is available.",
    "Fuel pump installed.",
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
    "The Ducati is roadworthy.",
  ])("flags actual roadworthiness language: %s", (answer) => {
    expect(codes(answer)).toContain("ROADWORTHINESS_CLAIM");
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
});
