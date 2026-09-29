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

function parsedContext(input: DiagnosticsContextSource) {
  const shaped = shapeDiagnosticsContext(input, {
    mode: "shop",
    workOrderId: "wo-1",
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
});
