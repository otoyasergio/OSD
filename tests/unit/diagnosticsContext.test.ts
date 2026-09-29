import { describe, expect, it } from "vitest";
import {
  DIAGNOSTICS_MAX_COLLECTION_ITEMS,
  DIAGNOSTICS_MAX_CONTEXT_TEXT_CHARS,
  shapeDiagnosticsContext,
} from "@/lib/diagnostics/context";

function source() {
  return {
    workOrder: {
      workOrderId: "wo-1",
      workOrderNumber: "TOR-1001",
      status: "in_progress",
      lifecycleState: "active",
      mileage: 12_345,
      complaint: "Intermittent no-crank",
      internalNotes: "Check after hot soak",
      customerName: "Private Customer",
      customerEmail: "private@example.com",
      address: "Private address",
      signatureStoragePath: "signatures/private.png",
    },
    motorcycle: {
      year: 2021,
      make: "Honda",
      model: "CB500F",
      colour: "Red",
      odometerUnit: "km",
      vin: "JH2PC0000MK123456",
      notes: "Catalogue note",
      customer: { phone: "555-0100" },
    },
    serviceInformation: {
      oilType: "10W-30",
      frontTireSize: "120/70-17",
      notes: "Copied from app catalogue",
    },
    jobs: [
      {
        jobId: "job-2",
        workOrderId: "wo-1",
        origin: "shop_added",
        serviceName: "Charging diagnosis",
        status: "ready_to_start",
        workState: "ready",
        notes: "Shop-only job",
      },
      {
        jobId: "job-1",
        workOrderId: "wo-1",
        origin: "customer_request",
        serviceName: "No-crank diagnosis",
        status: "in_progress",
        workState: "in_progress",
        notes: "Customer says it clicks once",
        completedAt: null,
        prices: {
          currency: "CAD",
          laborCents: 12_000,
          partsCents: 4_500,
          totalCents: 18_645,
        },
        authorization: {
          decision: "approved",
          decidedAt: "2026-09-28T12:00:00.000Z",
          method: "phone",
        },
        parts: [
          {
            partId: "part-1",
            description: "Starter relay",
            partNumber: "R-1",
            quantityRequired: 1,
            quantityReceived: 0,
            quantityInstalled: 0,
            state: "to_order",
            sellPriceCents: 4_500,
            supplierCostCents: 2_000,
          },
        ],
        checklist: [
          {
            checklistItemId: "check-1",
            title: "Record loaded voltage",
            checkedAt: null,
          },
        ],
        proof: {
          required: true,
          photoCount: 0,
          exceptionRecorded: false,
          photoUrls: ["https://private.example/proof.jpg"],
        },
      },
    ],
    inspection: {
      inspectionId: "inspection-1",
      workOrderId: "wo-1",
      completedAt: null,
      signatureStoragePath: "inspection-signatures/private.png",
      results: [
        {
          inspectionResultId: "result-2",
          category: "Battery",
          itemName: "Actual CCA",
          displayOrder: 20,
          status: null,
          measurement: null,
          notes: null,
        },
        {
          inspectionResultId: "result-1",
          category: "Battery",
          itemName: "Terminals",
          displayOrder: 10,
          status: "ok",
          measurement: "clean and tight",
          notes: "No corrosion",
        },
      ],
    },
    technicianNotes: [
      {
        technicianNoteId: "note-1",
        workOrderId: "wo-1",
        jobId: "job-1",
        noteType: "diagnostic_finding",
        note: "Voltage falls during crank request",
        createdAt: "2026-09-28T13:00:00.000Z",
      },
    ],
    recommendations: [
      {
        recommendationId: "rec-1",
        workOrderId: "wo-1",
        description: "Test starter relay control circuit",
        severity: "immediate_attention",
        status: "pending",
        notes: null,
      },
    ],
    checks: {
      quality: [
        {
          attemptId: "qc-1",
          workOrderId: "wo-1",
          outcome: "failed",
          checklist: { electrical: false },
          notes: "Diagnosis incomplete",
          performedAt: "2026-09-28T14:00:00.000Z",
          signatureStoragePath: "inspection-signatures/qc.png",
        },
      ],
      safety: [],
    },
    references: {
      exactModelOem: false,
      currentRecallLookup: false,
      currentOntarioInspection: false,
      officialInspectionTemplate: false,
      universalDiagnosticTree: false,
    },
  };
}

describe("diagnostics context shaping", () => {
  it("keeps diagnostic evidence and explicitly marks uninspected fields", () => {
    const result = shapeDiagnosticsContext(source(), {
      mode: "shop",
      workOrderId: "wo-1",
      jobId: "job-1",
      serverNowIso: "2026-09-29T03:30:00.000Z",
    });

    expect(result.context).toMatchObject({
      contextAsOf: "2026-09-29T03:30:00.000Z",
      workOrder: {
        workOrderId: "wo-1",
        identifier: "TOR-1001",
        status: "in_progress",
        mileage: { value: 12_345, unit: "km" },
        complaint: "Intermittent no-crank",
        internalNotes: "Check after hot soak",
      },
      motorcycle: {
        year: 2021,
        make: "Honda",
        model: "CB500F",
        colour: "Red",
        source: "unverified_app_catalogue_reference",
        verified: false,
      },
      selectedJob: {
        jobId: "job-1",
        status: "in_progress",
        workState: "in_progress",
      },
      inspection: {
        completed: false,
        completedAt: null,
        results: [
          expect.objectContaining({ inspectionResultId: "result-1", status: "ok" }),
          expect.objectContaining({
            inspectionResultId: "result-2",
            status: "uninspected",
            measurement: null,
            notes: null,
          }),
        ],
      },
      missingReferences: {
        exactModelOem: true,
        currentRecallLookup: true,
        currentOntarioInspection: true,
        officialInspectionTemplate: true,
        universalDiagnosticTree: true,
      },
    });
    expect(result.context.customerRequestJobs).toEqual([
      expect.objectContaining({
        jobId: "job-1",
        notes: "Customer says it clicks once",
      }),
    ]);
    expect(result.claims).toMatchObject({
      hasRecordedCustomerAuthorization: false,
      hasRecordedCompletedWork: false,
      hasVerificationEvidence: false,
      hasExactModelSource: false,
      hasCurrentRecallSource: false,
      hasCurrentOntarioInspectionSource: false,
      hasSuppliedPrices: false,
    });

    const serialized = JSON.stringify(result.context);
    for (const secret of [
      "Private Customer",
      "private@example.com",
      "Private address",
      "555-0100",
      "JH2PC0000MK123456",
      "signatures/private.png",
      "https://private.example/proof.jpg",
    ]) {
      expect(serialized).not.toContain(secret);
    }
  });

  it("excludes all prices and authorization details in technical modes", () => {
    const result = shapeDiagnosticsContext(source(), {
      mode: "report",
      workOrderId: "wo-1",
      jobId: "job-1",
    });
    const serialized = JSON.stringify(result.context);

    expect(serialized).not.toMatch(/price|cost|currency|total|authorization|decision/i);
    expect(serialized).not.toContain("18645");
    expect(serialized).not.toContain("4500");
    expect(serialized).not.toContain("2000");
  });

  it.each(["advisor", "intake"] as const)(
    "includes only supplied price and authorization facts in %s mode",
    (mode) => {
      const result = shapeDiagnosticsContext(source(), {
        mode,
        workOrderId: "wo-1",
        jobId: "job-1",
      });

      expect(result.context.selectedJob).toMatchObject({
        parts: [{ partId: "part-1", sellPriceCents: 4_500 }],
        pricing: {
          currency: "CAD",
          laborCents: 12_000,
          partsCents: 4_500,
          totalCents: 18_645,
        },
        authorization: {
          decision: "approved",
          decidedAt: "2026-09-28T12:00:00.000Z",
          method: "phone",
        },
      });
      expect(result.claims.hasRecordedCustomerAuthorization).toBe(true);
      expect(result.claims.hasSuppliedPrices).toBe(true);
      expect(JSON.stringify(result.context)).not.toContain("supplierCostCents");
    }
  );

  it("rejects cross-work-order source rows and job selection", () => {
    const mismatchedJobSource = source();
    mismatchedJobSource.jobs[0]!.workOrderId = "wo-2";
    expect(() =>
      shapeDiagnosticsContext(mismatchedJobSource, {
        mode: "shop",
        workOrderId: "wo-1",
      })
    ).toThrow("DIAGNOSTICS_CONTEXT_WORK_ORDER_MISMATCH");

    expect(() =>
      shapeDiagnosticsContext(source(), {
        mode: "shop",
        workOrderId: "wo-1",
        jobId: "missing-job",
      })
    ).toThrow("DIAGNOSTICS_CONTEXT_JOB_MISMATCH");
  });

  it("sorts and bounds text/arrays deterministically and hashes shaped context", () => {
    const firstSource = source();
    firstSource.technicianNotes = Array.from(
      { length: DIAGNOSTICS_MAX_COLLECTION_ITEMS + 2 },
      (_, index) => ({
        technicianNoteId: `note-${String(index).padStart(3, "0")}`,
        workOrderId: "wo-1",
        jobId: "job-1",
        noteType: "general",
        note: index === 0 ? "x".repeat(DIAGNOSTICS_MAX_CONTEXT_TEXT_CHARS + 30) : "note",
        createdAt: `2026-09-28T13:${String(index).padStart(2, "0")}:00.000Z`,
      })
    );
    const secondSource = structuredClone(firstSource);
    secondSource.inspection!.results.reverse();
    secondSource.technicianNotes.reverse();

    const options = {
      mode: "shop" as const,
      workOrderId: "wo-1",
      jobId: "job-1",
      serverNowIso: "2026-09-29T03:30:00.000Z",
    };
    const first = shapeDiagnosticsContext(firstSource, options);
    const second = shapeDiagnosticsContext(secondSource, options);

    expect(first.context.technicianNotes).toHaveLength(DIAGNOSTICS_MAX_COLLECTION_ITEMS);
    expect(first.context.technicianNotes[0]!.note.length).toBeLessThanOrEqual(
      DIAGNOSTICS_MAX_CONTEXT_TEXT_CHARS
    );
    expect(first.context).toEqual(second.context);
    expect(first.contextHash).toMatch(/^[a-f0-9]{64}$/);
    expect(first.contextHash).toBe(second.contextHash);
  });
});
