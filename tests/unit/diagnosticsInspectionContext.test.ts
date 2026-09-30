import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  DIAGNOSTICS_MAX_CONTEXT_BLOCK_CHARS,
  shapeDiagnosticsContext,
  type DiagnosticsContextSource,
} from "@/lib/diagnostics/context";

type TemplateRow = {
  category: string;
  itemName: string;
  displayOrder: number;
};

function migration014Rows(): TemplateRow[] {
  const sql = readFileSync(
    "supabase/migrations/014_visual_motorcycle_inspection_template.sql",
    "utf8"
  );
  return [...sql.matchAll(/\('((?:[^']|'')*)',\s*'((?:[^']|'')*)',\s*(\d+),/g)].map(
    (match) => ({
      category: match[1]!.replaceAll("''", "'"),
      itemName: match[2]!.replaceAll("''", "'"),
      displayOrder: Number(match[3]),
    })
  );
}

function source(rows: TemplateRow[]): DiagnosticsContextSource {
  return {
    workOrder: {
      workOrderId: "wo-1",
      workOrderNumber: "TOR-1001",
      status: "in_progress",
    },
    motorcycle: {
      year: 2024,
      make: "Honda",
      model: "CB500F",
      odometerUnit: "km",
    },
    jobs: [],
    inspection: {
      inspectionId: "inspection-1",
      workOrderId: "wo-1",
      completedAt: "2026-09-29T08:00:00.000Z",
      results: rows.map((row, index) => {
        const lateEvidence: Record<
          string,
          { status: string | null; measurement: string | null; notes: string | null }
        > = {
          "Leaks (Engine Oil, Gear Oil, Shaft Drive, Hydraulic Fluid, Coolant, Fuel)": {
            status: "immediate_attention",
            measurement: null,
            notes: "Coolant trace recorded at the lower hose.",
          },
          "Actual Cold Cranking Amps": {
            status: "ok",
            measurement: "180 A recorded",
            notes: null,
          },
          "Prior paint, chrome, or trim damage — Right side": {
            status: "future_attention",
            measurement: null,
            notes: "Right fairing scrape photographed.",
          },
          "Customer acknowledgment": {
            status: null,
            measurement: null,
            notes: null,
          },
        };
        const evidence = lateEvidence[row.itemName] ?? {
          status: "ok",
          measurement: null,
          notes: null,
        };
        return {
          inspectionResultId: `migration-014-result-${index}`,
          ...row,
          ...evidence,
        };
      }),
    },
    technicianNotes: [],
    recommendations: [],
    checks: { quality: [], safety: [] },
    references: {},
  };
}

function parsedContext(input: DiagnosticsContextSource, jobId?: string) {
  const shaped = shapeDiagnosticsContext(input, {
    mode: "shop",
    workOrderId: "wo-1",
    jobId,
  });
  return {
    shaped,
    parsed: JSON.parse(shaped.contextBlock.split("\n").slice(2, -1).join("\n")) as {
      inspection: {
        categories: Array<
          | {
              category: string;
              count: number;
              status: "ok";
              itemNames: string[];
            }
          | {
              category: string;
              count: number;
              status: "mixed_or_evidenced";
              items: Array<[string, string, string | null, string | null]>;
            }
        >;
        recordedResultCount: number;
        suppliedResultCount: number;
        supplyStatus: string;
        omittedMeaning: string | null;
        recordedStatusCounts: Record<string, number>;
      };
      selectedJob: {
        parts: unknown[];
        checklist: unknown[];
        verification: unknown[];
        truncation: {
          parts: { total: number; included: number; omitted: number; clipped: boolean };
          checklist: {
            total: number;
            included: number;
            omitted: number;
            clipped: boolean;
          };
          verification: {
            total: number;
            included: number;
            omitted: number;
            clipped: boolean;
          };
        };
      } | null;
      truncation: {
        inspectionResults: {
          total: number;
          included: number;
          omitted: number;
          clipped: boolean;
        };
      };
    },
  };
}

describe("diagnostics inspection context", () => {
  it("fits all 68 migration-014 rows while preserving late flagged, measured, and uninspected evidence", () => {
    const rows = migration014Rows();
    expect(rows).toHaveLength(68);

    const { shaped, parsed } = parsedContext(source(rows));
    const categories = parsed.inspection.categories;
    const suppliedNames = categories.flatMap((category) =>
      category.status === "ok"
        ? category.itemNames
        : category.items.map(([itemName]) => itemName)
    );

    expect(shaped.contextBlock.length).toBeLessThanOrEqual(
      DIAGNOSTICS_MAX_CONTEXT_BLOCK_CHARS
    );
    expect(suppliedNames).toEqual(rows.map((row) => row.itemName));
    expect(parsed.inspection).toMatchObject({
      recordedResultCount: 68,
      suppliedResultCount: 68,
      supplyStatus: "complete",
      omittedMeaning: null,
      recordedStatusCounts: {
        ok: 65,
        immediate_attention: 1,
        future_attention: 1,
        uninspected: 1,
      },
    });
    expect(parsed.truncation.inspectionResults).toEqual({
      total: 68,
      included: 68,
      omitted: 0,
      clipped: false,
    });

    const front = categories.find(
      (category) => category.category === "Brakes & Tires — Front"
    );
    expect(front).toMatchObject({
      status: "ok",
      count: 15,
      itemNames: rows.slice(0, 15).map((row) => row.itemName),
    });
    const fluids = categories.find(
      (category) => category.category === "Oil and Other Fluid Levels"
    );
    expect(fluids).toMatchObject({
      status: "mixed_or_evidenced",
      items: expect.arrayContaining([
        [
          "Leaks (Engine Oil, Gear Oil, Shaft Drive, Hydraulic Fluid, Coolant, Fuel)",
          "immediate_attention",
          null,
          "Coolant trace recorded at the lower hose.",
        ],
      ]),
    });
    const battery = categories.find((category) => category.category === "Battery");
    expect(battery).toMatchObject({
      items: expect.arrayContaining([
        ["Actual Cold Cranking Amps", "ok", "180 A recorded", null],
      ]),
    });
    const comments = categories.find(
      (category) => category.category === "Comments / Damage"
    );
    expect(comments).toMatchObject({
      items: expect.arrayContaining([
        [
          "Prior paint, chrome, or trim damage — Right side",
          "future_attention",
          null,
          "Right fairing scrape photographed.",
        ],
        ["Customer acknowledgment", "uninspected", null, null],
      ]),
    });
    expect(JSON.stringify(parsed.inspection)).not.toMatch(
      /migration-014-result|displayOrder|inspectionResultId/
    );
  });

  it("labels forced context omissions as recorded-but-not-supplied, never uninspected", () => {
    const rows = Array.from({ length: 100 }, (_, index) => ({
      category: "Oversized all-OK category",
      itemName: `Recorded OK item ${index} ${"x".repeat(470)}`,
      displayOrder: index,
    }));
    const { shaped, parsed } = parsedContext(source(rows));

    expect(shaped.contextBlock.length).toBeLessThanOrEqual(
      DIAGNOSTICS_MAX_CONTEXT_BLOCK_CHARS
    );
    expect(parsed.inspection.supplyStatus).toBe("recorded_rows_omitted");
    expect(parsed.inspection.omittedMeaning).toMatch(
      /recorded but not supplied in this context.*never.*not inspected/i
    );
    expect(parsed.inspection.recordedStatusCounts).toEqual({ ok: 100 });
    expect(parsed.truncation.inspectionResults).toMatchObject({
      total: 100,
      clipped: true,
      omitted: expect.any(Number),
    });
    expect(parsed.truncation.inspectionResults.omitted).toBeGreaterThan(0);
  });

  it("prioritizes late non-OK categories, then measured categories, near the 48k limit", () => {
    const rows = Array.from({ length: 90 }, (_, index) => ({
      category:
        index < 30
          ? `All OK category ${index}`
          : index < 60
            ? `Measured category ${index}`
            : `Non-OK category ${index}`,
      itemName: `Inspection item ${index} ${"x".repeat(430)}`,
      displayOrder: index,
    }));
    const input = source(rows);
    input.workOrder.complaint = "Customer complaint ".padEnd(500, "c");
    input.workOrder.internalNotes = "Internal diagnostic note ".padEnd(500, "i");
    input.motorcycle.notes = "Motorcycle record note ".padEnd(500, "m");
    input.serviceInformation = {
      oilFilter: "filter ".padEnd(500, "f"),
      oilType: "oil ".padEnd(500, "o"),
      oilCapacity: "capacity ".padEnd(500, "c"),
      airFilter: "air ".padEnd(500, "a"),
      sparkPlugs: "plug ".padEnd(500, "p"),
      frontBrakePads: "front ".padEnd(500, "f"),
      rearBrakePads: "rear ".padEnd(500, "r"),
      frontTireSize: "front tire ".padEnd(500, "t"),
      rearTireSize: "rear tire ".padEnd(500, "t"),
      chain: "chain ".padEnd(500, "h"),
      battery: "battery ".padEnd(500, "b"),
      notes: "catalogue note ".padEnd(500, "n"),
    };
    input.jobs = Array.from({ length: 100 }, (_, index) => ({
      jobId: `job-${index}`,
      workOrderId: "wo-1",
      origin: "customer_request",
      serviceName: `Customer request ${index} ${"j".repeat(450)}`,
      status: "in_progress",
      notes: `Job note ${index} ${"j".repeat(450)}`,
    }));
    input.jobs[0] = {
      ...input.jobs[0]!,
      parts: Array.from({ length: 100 }, (_, index) => ({
        partId: `part-${String(index).padStart(3, "0")}`,
        description: `Selected job part ${index} ${"p".repeat(450)}`,
        quantityRequired: 1,
        quantityReceived: 1,
        quantityAllocated: 1,
        quantityInstalled: index % 2,
        state: index % 2 ? "installed" : "allocated",
        notes: `Part evidence ${index} ${"p".repeat(450)}`,
      })),
      checklist: Array.from({ length: 100 }, (_, index) => ({
        checklistItemId: `checklist-${String(index).padStart(3, "0")}`,
        title: `Selected job checklist ${index} ${"c".repeat(450)}`,
        checkedAt:
          index % 2 === 0
            ? `2026-09-29T07:${String(index % 60).padStart(2, "0")}:00.000Z`
            : null,
      })),
      verification: Array.from({ length: 100 }, (_, index) => ({
        verificationId: `verification-${String(index).padStart(3, "0")}`,
        result: index === 99 ? "failed" : "recorded",
        notes: `Selected job verification ${index} ${"v".repeat(450)}`,
        recordedAt: `2026-09-${String(1 + (index % 29)).padStart(2, "0")}T${String(
          index % 24
        ).padStart(2, "0")}:00:00.000Z`,
      })),
    };
    input.technicianNotes = Array.from({ length: 100 }, (_, index) => ({
      technicianNoteId: `note-${index}`,
      workOrderId: "wo-1",
      jobId: null,
      noteType: "diagnostic",
      note: `Technician note ${index} ${"t".repeat(470)}`,
      createdAt: `2026-09-29T08:${String(index % 60).padStart(2, "0")}:00.000Z`,
    }));
    input.recommendations = Array.from({ length: 100 }, (_, index) => ({
      recommendationId: `recommendation-${index}`,
      workOrderId: "wo-1",
      description: `Recommendation ${index} ${"r".repeat(460)}`,
      severity: index % 2 === 0 ? "safety_critical" : "immediate_attention",
      status: "pending",
      notes: `Recommendation note ${index} ${"n".repeat(450)}`,
    }));
    input.checks = {
      quality: Array.from({ length: 20 }, (_, index) => ({
        attemptId: `quality-${index}`,
        workOrderId: "wo-1",
        outcome: "recorded",
        checklist: { step: `Quality step ${index} ${"q".repeat(70)}` },
        notes: `Quality note ${index} ${"q".repeat(470)}`,
        performedAt: `2026-09-29T09:${String(index).padStart(2, "0")}:00.000Z`,
      })),
      safety: Array.from({ length: 20 }, (_, index) => ({
        attemptId: `safety-${index}`,
        workOrderId: "wo-1",
        outcome: "recorded",
        checklist: { step: `Safety step ${index} ${"s".repeat(70)}` },
        notes: `Safety note ${index} ${"s".repeat(470)}`,
        performedAt: `2026-09-29T10:${String(index).padStart(2, "0")}:00.000Z`,
      })),
    };
    input.references = {
      exactModelOem: { text: "OEM reference ".padEnd(500, "o") },
      currentRecallLookup: { text: "Recall reference ".padEnd(500, "r") },
      currentOntarioInspection: {
        text: "Ontario inspection reference ".padEnd(500, "i"),
      },
      officialInspectionTemplate: {
        text: "Inspection template ".padEnd(500, "t"),
      },
      universalDiagnosticTree: {
        text: "Diagnostic tree ".padEnd(500, "d"),
      },
    };
    input.inspection!.results = input.inspection!.results.map((result, index) => ({
      ...result,
      status:
        index < 60
          ? "ok"
          : index % 3 === 0
            ? "immediate_attention"
            : index % 3 === 1
              ? "future_attention"
              : null,
      measurement: index >= 30 && index < 60 ? `${index} psi recorded` : null,
      notes: index >= 60 ? `Flagged evidence ${index}` : null,
    }));

    const { shaped, parsed } = parsedContext(input, "job-0");
    const suppliedCategories = parsed.inspection.categories.map(
      (category) => category.category
    );
    const suppliedNonOk = suppliedCategories.filter((category) =>
      category.startsWith("Non-OK category")
    );
    const suppliedMeasured = suppliedCategories.filter((category) =>
      category.startsWith("Measured category")
    );
    const suppliedAllOk = suppliedCategories.filter((category) =>
      category.startsWith("All OK category")
    );

    expect(shaped.contextBlock.length).toBeGreaterThan(
      DIAGNOSTICS_MAX_CONTEXT_BLOCK_CHARS * 0.8
    );
    expect(shaped.contextBlock.length).toBeLessThanOrEqual(
      DIAGNOSTICS_MAX_CONTEXT_BLOCK_CHARS
    );
    expect(suppliedNonOk).toEqual(
      Array.from({ length: 30 }, (_, index) => `Non-OK category ${index + 60}`)
    );
    expect(suppliedMeasured.length).toBeGreaterThan(0);
    expect(suppliedAllOk).toHaveLength(0);
    expect(parsed.selectedJob).not.toBeNull();
    expect(parsed.selectedJob?.parts.length).toBeGreaterThan(0);
    expect(parsed.selectedJob?.checklist.length).toBeGreaterThan(0);
    expect(parsed.selectedJob?.verification.length).toBeGreaterThan(0);
    expect(parsed.selectedJob?.truncation).toMatchObject({
      parts: { total: 100, clipped: true, omitted: expect.any(Number) },
      checklist: { total: 100, clipped: true, omitted: expect.any(Number) },
      verification: { total: 100, clipped: true, omitted: expect.any(Number) },
    });
    expect(parsed.selectedJob!.truncation.parts.omitted).toBeGreaterThan(0);
    expect(parsed.selectedJob!.truncation.checklist.omitted).toBeGreaterThan(0);
    expect(parsed.selectedJob!.truncation.verification.omitted).toBeGreaterThan(0);
  });
});
