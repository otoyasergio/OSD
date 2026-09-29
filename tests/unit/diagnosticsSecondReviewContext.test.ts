import { describe, expect, it } from "vitest";
import {
  shapeDiagnosticsContext,
  type DiagnosticsContextSource,
} from "@/lib/diagnostics/context";

function source(): DiagnosticsContextSource {
  return {
    workOrder: {
      workOrderId: "wo-1",
      workOrderNumber: "TOR-1001",
      status: "in_progress",
      complaint: "No crank",
      internalNotes: null,
    },
    motorcycle: {
      year: 2022,
      make: "Honda",
      model: "CB500F",
      colour: "black",
      odometerUnit: "km",
    },
    jobs: [
      {
        jobId: "job-1",
        workOrderId: "wo-1",
        origin: "customer_request",
        serviceName: "Diagnosis",
        status: "in_progress",
        parts: [],
        checklist: [],
        verification: [],
      },
    ],
    technicianNotes: [],
    recommendations: [],
    checks: { quality: [], safety: [] },
    references: {},
  };
}

describe("second review context regressions", () => {
  it("redacts exact supplied customer terms and preserves surrounding URL/path text", () => {
    const input = source();
    input.workOrder.internalNotes =
      "Alex Example reported alex@customer.test and 647-424-1088. Before https://private.test/photo.jpg after. Keep before wo-1/photos/private.jpg after. Invalid 123-456-7890 stays.";
    input.motorcycle.notes = "VIN JH2PC0000MK123456 belongs to Alex Example.";

    const result = shapeDiagnosticsContext(input, {
      mode: "shop",
      workOrderId: "wo-1",
      redactTerms: {
        customerName: "Alex Example",
        email: "alex@customer.test",
        phone: "647-424-1088",
        fullVin: "JH2PC0000MK123456",
      },
    });
    const serialized = JSON.stringify(result.context);

    expect(serialized).not.toMatch(
      /Alex Example|alex@customer\.test|647-424-1088|JH2PC0000MK123456|private\.test|private\.jpg/
    );
    expect(serialized).toContain("[REDACTED_NAME]");
    expect(serialized).toContain("[REDACTED_EMAIL]");
    expect(serialized).toContain("[REDACTED_PHONE]");
    expect(serialized).toContain("[REDACTED_VIN]");
    expect(serialized).toContain("Before [REDACTED_URL] after");
    expect(serialized).toContain("Keep before [REDACTED_PATH] after");
    expect(serialized).toContain("123-456-7890 stays");
  });

  it("separates included measured readings from verified specifications", () => {
    const input = source();
    input.inspection = {
      inspectionId: "inspection-1",
      workOrderId: "wo-1",
      completedAt: null,
      results: [
        {
          inspectionResultId: "result-1",
          category: "Battery",
          itemName: "Voltage",
          displayOrder: 1,
          status: "future_attention",
          measurement: "Recorded 12.6 volts",
          notes: null,
        },
      ],
    };
    input.technicianNotes = [
      {
        technicianNoteId: "note-1",
        workOrderId: "wo-1",
        jobId: "job-1",
        noteType: "general",
        note: "A note mentions 14 volts.",
        createdAt: "2026-09-29T01:00:00.000Z",
      },
    ];
    input.references = {
      exactModelOem: {
        text: "Verified exact-model specification: charging limit 14.5 volts.",
      },
    };

    const result = shapeDiagnosticsContext(input, {
      mode: "shop",
      workOrderId: "wo-1",
      jobId: "job-1",
    });

    expect(result.claims.allowedMeasuredValues).toEqual(
      expect.arrayContaining(["12.6:v", "14:v"])
    );
    expect(result.claims.allowedSpecificationValues).toEqual(["14.5:v"]);
    expect(result.claims.allowedSpecificationValues).not.toContain("14:v");
  });

  it("applies one global checklist work budget and denies identity/signature keys", () => {
    const input = source();
    input.checks!.quality = [
      {
        attemptId: "attempt-1",
        workOrderId: "wo-1",
        outcome: "failed",
        performedAt: "2026-09-29T01:00:00.000Z",
        checklist: {
          name: "Private Name",
          signed_by: "Private Signer",
          initials: "PS",
          branches: Array.from({ length: 500 }, (_, index) => ({
            [`node_${index}`]: Array.from({ length: 20 }, () => ({
              result: "x".repeat(2_000),
            })),
          })),
        },
      },
    ];

    const result = shapeDiagnosticsContext(input, {
      mode: "shop",
      workOrderId: "wo-1",
    });
    const checklist = JSON.stringify(result.context.checks.quality[0]?.checklist);

    expect(checklist).not.toMatch(/Private Name|Private Signer|"initials"/);
    expect(checklist.length).toBeLessThan(20_000);
    expect(result.context.truncation).not.toHaveProperty("aggregate");
  });
});
