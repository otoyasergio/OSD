import { describe, expect, it } from "vitest";
import {
  PassportSourceError,
  buildPassportDraft,
  type PassportDraftInput,
} from "@/lib/passport/buildDraft";
import { hashPassportPayload } from "@/lib/passport/digest";
import { assertPassportReviewCurrent, createPassportReview } from "@/lib/passport/review";

function sourceInput(): PassportDraftInput {
  return {
    passportNumber: "OTO-8H2K4M6P",
    reportVersion: 1,
    issuedAt: "2026-10-31T02:30:00.000Z",
    motorcycle: {
      year: 2021,
      make: "Honda",
      model: "CB650R",
      vin: "MLHRC7412M5000001",
      colour: "Red",
    },
    sensitiveValues: ["Previous Owner", "previous-owner@example.com", "647-555-0199"],
    workOrders: [
      {
        work_order_id: "00000000-0000-4000-8000-000000000102",
        work_order_number: "TOR-1043",
        status: "completed",
        completed_at: "2026-10-20T18:00:00.000Z",
        mileage: 12_800,
        mileage_unit: "km",
        location_name: "Toronto",
        jobs: [
          {
            job_id: "00000000-0000-4000-8000-000000000202",
            public_service_name: "Chain adjustment",
            status: "completed",
            part_requirements: [],
          },
          {
            job_id: "00000000-0000-4000-8000-000000000203",
            public_service_name: "Declined tire replacement",
            status: "declined",
            part_requirements: [],
          },
        ],
      },
      {
        work_order_id: "00000000-0000-4000-8000-000000000101",
        work_order_number: "TOR-1042",
        status: "completed",
        completed_at: "2026-10-01T17:00:00.000Z",
        mileage: 12_450,
        mileage_unit: "km",
        location_name: "Toronto",
        jobs: [
          {
            job_id: "00000000-0000-4000-8000-000000000201",
            public_service_name: "Engine oil and filter service",
            status: "completed",
            part_requirements: [
              {
                description: "Oil filter",
                part_number: "15410-MFJ-D02",
                quantity_installed: 1,
                state: "installed",
              },
              {
                description: "Unused drain washer",
                part_number: null,
                quantity_installed: 0,
                state: "allocated",
              },
            ],
          },
        ],
      },
      {
        work_order_id: "00000000-0000-4000-8000-000000000103",
        work_order_number: "TOR-1044",
        status: "open",
        completed_at: null,
        mileage: 13_000,
        mileage_unit: "km",
        location_name: "Toronto",
        jobs: [
          {
            job_id: "00000000-0000-4000-8000-000000000204",
            public_service_name: "Work still in progress",
            status: "in_progress",
            part_requirements: [],
          },
        ],
      },
    ],
  };
}

describe("buildPassportDraft", () => {
  it("projects only completed service facts and installed part fields", () => {
    const result = buildPassportDraft(sourceInput());

    expect(result.sourceWorkOrderIds).toEqual([
      "00000000-0000-4000-8000-000000000101",
      "00000000-0000-4000-8000-000000000102",
    ]);
    expect(result.payload.service_entries).toHaveLength(2);
    expect(result.payload.service_entries[0]).toMatchObject({
      work_order_reference: "TOR-1042",
      completed_services: ["Engine oil and filter service"],
      installed_parts: [
        {
          description: "Oil filter",
          part_number: "15410-MFJ-D02",
          quantity: 1,
        },
      ],
    });
    expect(JSON.stringify(result.payload)).not.toMatch(
      /customer|message|payment|price|billing|square/i
    );
  });

  it("sorts sources deterministically and produces a stable digest", () => {
    const input = sourceInput();
    const first = buildPassportDraft(input);
    const second = buildPassportDraft({
      ...input,
      workOrders: [...input.workOrders].reverse(),
    });

    expect(second.payload).toEqual(first.payload);
    expect(second.payloadSha256).toBe(first.payloadSha256);
    expect(first.payloadSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("hashes equivalent JSON identically even when object keys are reordered", () => {
    const payload = buildPassportDraft(sourceInput()).payload;
    const reordered = {
      limitations: payload.limitations,
      service_entries: payload.service_entries.map((entry) => ({
        installed_parts: entry.installed_parts,
        completed_services: entry.completed_services,
        source_label: entry.source_label,
        location: entry.location,
        mileage: entry.mileage,
        work_order_reference: entry.work_order_reference,
        service_date: entry.service_date,
      })),
      vehicle: payload.vehicle,
      issuer: payload.issuer,
      coverage_through: payload.coverage_through,
      issued_at: payload.issued_at,
      report_version: payload.report_version,
      passport_number: payload.passport_number,
      schema_version: payload.schema_version,
    };

    expect(hashPassportPayload(reordered)).toBe(hashPassportPayload(payload));
  });

  it("preserves each observed mileage unit without conversion", () => {
    const input = sourceInput();
    input.workOrders[1].mileage = 7_735;
    input.workOrders[1].mileage_unit = "mi";

    const result = buildPassportDraft(input);

    expect(result.payload.service_entries[0].mileage).toEqual({
      value: 7_735,
      unit: "mi",
    });
  });

  it("blocks completed work orders with no completion timestamp", () => {
    const input = sourceInput();
    input.workOrders[0].completed_at = null;

    expect(() => buildPassportDraft(input)).toThrow(PassportSourceError);
    expect(() => buildPassportDraft(input)).toThrow("PASSPORT_COMPLETION_DATE_REQUIRED");
  });

  it("blocks prior-owner contact values embedded in a completed service name", () => {
    const input = sourceInput();
    input.workOrders[0].jobs[0].public_service_name =
      "Follow-up for previous-owner@example.com";

    expect(() => buildPassportDraft(input)).toThrow("PASSPORT_DISCLOSURE_RISK");
  });

  it("blocks owner-name components and price language in a public service label", () => {
    const input = sourceInput();
    input.sensitiveValues = [...(input.sensitiveValues ?? []), "Jane"];
    input.workOrders[0].jobs[0].public_service_name =
      "Jane reports vibration — quote $250";

    expect(() => buildPassportDraft(input)).toThrow("PASSPORT_DISCLOSURE_RISK");
  });

  it("binds publication to the reviewed digest, version, timestamp, and sources", () => {
    const reviewedDraft = {
      ...buildPassportDraft(sourceInput()),
      sourceSha256: "a".repeat(64),
    };
    const review = createPassportReview(reviewedDraft);

    expect(() => assertPassportReviewCurrent(review, reviewedDraft)).not.toThrow();

    const changedInput = sourceInput();
    changedInput.workOrders[0].jobs[0].public_service_name = "Changed after review";
    const changedDraft = {
      ...buildPassportDraft(changedInput),
      sourceSha256: "b".repeat(64),
    };
    expect(() => assertPassportReviewCurrent(review, changedDraft)).toThrow(
      "PASSPORT_PREVIEW_STALE"
    );
  });
});
