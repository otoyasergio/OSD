import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  DIAGNOSTICS_MAX_CONTEXT_BLOCK_CHARS,
  shapeDiagnosticsContext,
  type DiagnosticsContextSource,
} from "@/lib/diagnostics/context";

function baseSource(): DiagnosticsContextSource {
  return {
    workOrder: {
      workOrderId: "wo-1",
      workOrderNumber: "TOR-1001",
      status: "in_progress",
      mileage: 1_234,
      complaint: "No crank",
      internalNotes: "Inspect starter circuit",
    },
    motorcycle: {
      year: 2021,
      make: "Honda",
      model: "CB500F",
      colour: "red",
      odometerUnit: "km",
      vin: "JH2PC0000MK123456",
    },
    jobs: [
      {
        jobId: "job-1",
        workOrderId: "wo-1",
        origin: "customer_request",
        serviceName: "No-crank diagnosis",
        status: "in_progress",
        notes: "Selected job",
        parts: [],
        checklist: [],
        verification: [],
      },
      {
        jobId: "job-2",
        workOrderId: "wo-1",
        origin: "customer_request",
        serviceName: "Other job",
        status: "ready",
        notes: "OTHER_JOB_SECRET",
      },
    ],
    technicianNotes: [],
    recommendations: [],
    checks: { quality: [], safety: [] },
    references: {},
  };
}

describe("diagnostics context hardening", () => {
  it("stamps mode/audience and hashes the exact complete untrusted block", () => {
    const result = shapeDiagnosticsContext(baseSource(), {
      mode: "shop",
      workOrderId: "wo-1",
      jobId: "job-1",
    });

    expect(result.context).toMatchObject({
      mode: "shop",
      audience: "technical",
    });
    expect(result.contextBlock.length).toBeLessThanOrEqual(
      DIAGNOSTICS_MAX_CONTEXT_BLOCK_CHARS
    );
    expect(result.contextHash).toBe(
      createHash("sha256").update(result.contextBlock).digest("hex")
    );
    expect(() =>
      JSON.parse(result.contextBlock.split("\n").slice(2, -1).join("\n"))
    ).not.toThrow();
  });

  it("labels verification rows as recorded evidence without implying success", () => {
    const input = baseSource();
    input.jobs[0]!.verification = [
      {
        verificationId: "verification-1",
        result: "pending",
        notes: "Comparable retest still required",
        recordedAt: "2026-09-29T01:00:00.000Z",
      },
    ];

    const result = shapeDiagnosticsContext(input, {
      mode: "shop",
      workOrderId: "wo-1",
      jobId: "job-1",
    });

    expect(result.context.selectedJob?.verificationEvidenceRecorded).toBe(true);
    expect(result.claims.hasVerificationEvidence).toBe(false);
  });

  it("redacts PII in every free-text field and sanitizes deep values", () => {
    const input = baseSource();
    input.workOrder.internalNotes =
      "VIN JH2PC0000MK123456, email rider@example.com, phone (647) 424-1088";
    input.serviceInformation = {
      notes: "rider@example.com / 647-424-1088 / JH2PC0000MK123456",
    };
    input.checks!.quality = [
      {
        attemptId: "q-1",
        workOrderId: "wo-1",
        outcome: "failed",
        performedAt: "2026-09-29T01:00:00.000Z",
        checklist: {
          safe: true,
          photoUrl: "https://example.com/private.jpg",
          nested: {
            tokenValue: "secret",
            direct: "https://example.com/also-private",
            pathValue: "wo-1/photos/private.jpg",
            level2: { level3: { level4: { shouldDisappear: "secret" } } },
          },
        },
      },
    ];

    const result = shapeDiagnosticsContext(input, {
      mode: "shop",
      workOrderId: "wo-1",
      jobId: "job-1",
    });
    const serialized = JSON.stringify(result.context);

    expect(serialized).not.toMatch(
      /JH2PC0000MK123456|rider@example\.com|647.?424.?1088|https?:|private\.jpg|secret/
    );
    expect(serialized).toContain("[REDACTED_VIN]");
    expect(serialized).toContain("[REDACTED_EMAIL]");
    expect(serialized).toContain("[REDACTED_PHONE]");
  });

  it("keeps newest in-scope notes and records every omission deterministically", () => {
    const input = baseSource();
    input.technicianNotes = Array.from({ length: 80 }, (_, index) => ({
      technicianNoteId: `selected-${index}`,
      workOrderId: "wo-1",
      jobId: index === 79 ? "job-2" : index % 2 ? "job-1" : null,
      noteType: "general",
      note: `note-${index}-${"x".repeat(600)}`,
      createdAt: `2026-09-${String((index % 28) + 1).padStart(2, "0")}T12:00:00.000Z`,
    }));
    input.recommendations = [
      {
        recommendationId: "wo-rec",
        workOrderId: "wo-1",
        jobId: null,
        description: "WO level",
        severity: "safety_critical",
        status: "pending",
      },
      {
        recommendationId: "selected-rec",
        workOrderId: "wo-1",
        jobId: "job-1",
        description: "Selected",
        severity: "immediate_attention",
        status: "pending",
      },
      {
        recommendationId: "other-rec",
        workOrderId: "wo-1",
        jobId: "job-2",
        description: "OTHER_JOB_SECRET",
        severity: "future_attention",
        status: "pending",
      },
    ];

    const first = shapeDiagnosticsContext(input, {
      mode: "shop",
      workOrderId: "wo-1",
      jobId: "job-1",
    });
    const reversed = structuredClone(input);
    reversed.technicianNotes!.reverse();
    const second = shapeDiagnosticsContext(reversed, {
      mode: "shop",
      workOrderId: "wo-1",
      jobId: "job-1",
    });

    expect(first.context).toEqual(second.context);
    expect(JSON.stringify(first.context)).not.toContain("OTHER_JOB_SECRET");
    expect(
      first.context.technicianNotes[0]!.createdAt >=
        first.context.technicianNotes.at(-1)!.createdAt
    ).toBe(true);
    expect(first.context.truncation.technicianNotes).toMatchObject({
      clipped: true,
      total: expect.any(Number),
      included: first.context.technicianNotes.length,
      omitted: expect.any(Number),
    });
    expect(first.context.recommendations.map((item) => item.recommendationId)).toEqual([
      "wo-rec",
      "selected-rec",
    ]);
  });

  it("preserves required metadata and valid JSON under worst-case bounded input", () => {
    const input = baseSource();
    input.inspection = {
      inspectionId: "inspection-1",
      workOrderId: "wo-1",
      completedAt: null,
      results: Array.from({ length: 500 }, (_, index) => ({
        inspectionResultId: `result-${index}`,
        category: "category".repeat(100),
        itemName: "item".repeat(200),
        displayOrder: index,
        status: null,
        measurement: "measurement".repeat(200),
        notes: "notes".repeat(300),
      })),
    };
    input.technicianNotes = Array.from({ length: 500 }, (_, index) => ({
      technicianNoteId: `note-${index}`,
      workOrderId: "wo-1",
      jobId: "job-1",
      noteType: "general",
      note: "n".repeat(5_000),
      createdAt: new Date(2_000_000_000_000 - index * 1_000).toISOString(),
    }));
    input.serviceInformation = {
      oilFilter: "x".repeat(5_000),
      oilType: "x".repeat(5_000),
      oilCapacity: "x".repeat(5_000),
      airFilter: "x".repeat(5_000),
      sparkPlugs: "x".repeat(5_000),
      frontBrakePads: "x".repeat(5_000),
      rearBrakePads: "x".repeat(5_000),
      frontTireSize: "x".repeat(5_000),
      rearTireSize: "x".repeat(5_000),
      chain: "x".repeat(5_000),
      battery: "x".repeat(5_000),
      notes: "x".repeat(5_000),
    };
    input.references = {
      exactModelOem: { text: "x".repeat(5_000) },
      currentRecallLookup: { text: "x".repeat(5_000) },
      currentOntarioInspection: { text: "x".repeat(5_000) },
      officialInspectionTemplate: { text: "x".repeat(5_000) },
      universalDiagnosticTree: { text: "x".repeat(5_000) },
    };
    input.jobs[0]!.parts = Array.from({ length: 200 }, (_, index) => ({
      partId: `part-${index}`,
      description: "x".repeat(5_000),
      state: "planned",
    }));
    input.jobs[0]!.checklist = Array.from({ length: 200 }, (_, index) => ({
      checklistItemId: `check-${index}`,
      title: "x".repeat(5_000),
      checkedAt: null,
    }));
    input.jobs[0]!.verification = Array.from({ length: 200 }, (_, index) => ({
      verificationId: `verification-${index}`,
      result: "x".repeat(5_000),
      notes: "x".repeat(5_000),
      recordedAt: new Date(2_000_000_000_000 - index * 1_000).toISOString(),
    }));

    const result = shapeDiagnosticsContext(input, {
      mode: "shop",
      workOrderId: "wo-1",
      jobId: "job-1",
    });
    const parsed = JSON.parse(result.contextBlock.split("\n").slice(2, -1).join("\n"));

    expect(result.contextBlock.length).toBeLessThanOrEqual(
      DIAGNOSTICS_MAX_CONTEXT_BLOCK_CHARS
    );
    expect(parsed).toMatchObject({
      mode: "shop",
      audience: "technical",
      missingReferences: expect.any(Object),
      selectedJob: expect.any(Object),
      checks: expect.any(Object),
      truncation: {
        inspectionResults: { clipped: true },
        technicianNotes: { clipped: true },
      },
    });
  });

  it("derives authorization and reference claims only from included evidence", () => {
    for (const decision of ["declined", "deferred"]) {
      const input = baseSource();
      input.jobs[0].authorization = {
        decision,
        decidedAt: "2026-09-29T01:00:00.000Z",
      };
      input.references = {
        exactModelOem: true,
        currentRecallLookup: { text: " " },
      };
      const result = shapeDiagnosticsContext(input, {
        mode: "advisor",
        workOrderId: "wo-1",
        jobId: "job-1",
      });

      expect(result.claims.hasRecordedCustomerAuthorization).toBe(false);
      expect(result.claims.hasExactModelSource).toBe(false);
      expect(result.claims.hasCurrentRecallSource).toBe(false);
    }

    const supplied = baseSource();
    supplied.references = {
      exactModelOem: {
        text: "Exact-model manual: torque 42 N·m and pressure 36 psi.",
      },
    };
    const result = shapeDiagnosticsContext(supplied, {
      mode: "shop",
      workOrderId: "wo-1",
      jobId: "job-1",
    });
    expect(result.claims).toMatchObject({
      hasExactModelSource: true,
      allowedTechnicalValues: expect.arrayContaining(["42:nm", "36:psi"]),
    });
  });

  it("accepts only a canonical supplied server ISO timestamp", () => {
    expect(() =>
      shapeDiagnosticsContext(baseSource(), {
        mode: "shop",
        workOrderId: "wo-1",
        serverNowIso: "not-a-server-time",
      })
    ).toThrow("DIAGNOSTICS_CONTEXT_TIME_INVALID");
  });
});
