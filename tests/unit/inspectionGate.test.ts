import { describe, it, expect } from "vitest";
import {
  assertInspectionCompletedForJobFinish,
  assertInspectionPhotosComplete,
  countIncompleteInspectionResults,
  getMissingInspectionPhotos,
  getRequiredInspectionPhotos,
  isInspectionReadOnly,
  BRAKE_INSPECTION_SKIP_ITEM,
} from "@/lib/services/inspectionGate";

describe("isInspectionReadOnly", () => {
  const editable = {
    is_foreign_location: false,
    completed_at: null,
    work_order_status: "inspection_in_progress",
    canEdit: true,
  };

  it("is editable for an active work order with edit permission", () => {
    expect(isInspectionReadOnly(editable)).toBe(false);
  });

  it("is read-only once the inspection is completed", () => {
    expect(
      isInspectionReadOnly({
        ...editable,
        completed_at: "2026-07-09T12:00:00.000Z",
      })
    ).toBe(true);
  });

  it("is read-only for terminal work orders", () => {
    expect(
      isInspectionReadOnly({ ...editable, work_order_status: "completed" })
    ).toBe(true);
    expect(
      isInspectionReadOnly({ ...editable, work_order_status: "cancelled" })
    ).toBe(true);
  });

  it("is read-only for foreign locations and viewers without edit rights", () => {
    expect(
      isInspectionReadOnly({ ...editable, is_foreign_location: true })
    ).toBe(true);
    expect(isInspectionReadOnly({ ...editable, canEdit: false })).toBe(true);
  });
});

describe("assertInspectionCompletedForJobFinish", () => {
  it("blocks job finish when inspection.completed_at is null", () => {
    expect(() => assertInspectionCompletedForJobFinish(null)).toThrow(
      "INSPECTION_NOT_COMPLETED"
    );
    expect(() => assertInspectionCompletedForJobFinish(undefined)).toThrow(
      "INSPECTION_NOT_COMPLETED"
    );
  });

  it("allows job finish when inspection is completed", () => {
    expect(() =>
      assertInspectionCompletedForJobFinish("2026-07-09T12:00:00.000Z")
    ).not.toThrow();
  });
});

describe("countIncompleteInspectionResults", () => {
  it("counts blank statuses as incomplete", () => {
    expect(
      countIncompleteInspectionResults([
        {
          status: "ok",
          category_snapshot: "Battery",
          item_name_snapshot: "Battery Terminal / Cables / Mountings",
        },
        {
          status: null,
          category_snapshot: "Battery",
          item_name_snapshot: "Check Condition of Battery",
        },
      ])
    ).toBe(1);
  });

  it("skips incomplete Brakes & Tires items when skip item is OK", () => {
    expect(
      countIncompleteInspectionResults([
        {
          status: null,
          category_snapshot: "Brakes & Tires — Front",
          item_name_snapshot: "Front spokes",
        },
        {
          status: null,
          category_snapshot: "Brakes & Tires — Rear",
          item_name_snapshot: "Rear rotor",
        },
        {
          status: "ok",
          category_snapshot: "Brakes & Tires",
          item_name_snapshot: BRAKE_INSPECTION_SKIP_ITEM,
        },
        {
          status: null,
          category_snapshot: "Battery",
          item_name_snapshot: "Check Condition of Battery",
        },
      ])
    ).toBe(1);
  });

  it("still requires brake items when skip is not marked OK", () => {
    expect(
      countIncompleteInspectionResults([
        {
          status: null,
          category_snapshot: "Brakes & Tires — Front",
          item_name_snapshot: "Front spokes",
        },
        {
          status: null,
          category_snapshot: "Brakes & Tires",
          item_name_snapshot: BRAKE_INSPECTION_SKIP_ITEM,
        },
      ])
    ).toBe(2);
  });
});

describe("inspection photo requirements", () => {
  const base = [
    {
      inspection_result_id: "a0000000-0000-4000-8000-000000000001",
      status: "ok" as string | null,
      category_snapshot: "Brakes & Tires — Front",
      item_name_snapshot: "Front tire tread",
    },
    {
      inspection_result_id: "a0000000-0000-4000-8000-000000000002",
      status: "ok" as string | null,
      category_snapshot: "Brakes & Tires — Front",
      item_name_snapshot: "Front brake lining",
    },
    {
      inspection_result_id: "a0000000-0000-4000-8000-000000000003",
      status: "ok" as string | null,
      category_snapshot: "Frame, Chassis, and Suspension",
      item_name_snapshot:
        "Front Forks (oil, smooth travel, equal air pressure/damping)",
    },
    {
      inspection_result_id: "a0000000-0000-4000-8000-000000000004",
      status: "immediate_attention" as string | null,
      category_snapshot: "Battery",
      item_name_snapshot: "Check Condition of Battery (Storage Capacity Test)",
    },
  ];

  it("requires tires, brakes, forks, and flagged-item photos", () => {
    const required = getRequiredInspectionPhotos(base);
    expect(required.map((r) => r.category)).toEqual([
      "inspection_tires",
      "inspection_brakes",
      "inspection_forks",
      "inspection_item",
    ]);
    expect(required.find((r) => r.kind === "item")?.inspection_result_id).toBe(
      "a0000000-0000-4000-8000-000000000004"
    );
  });

  it("skips tire/brake photo requirements when brake inspection not performed", () => {
    const required = getRequiredInspectionPhotos([
      ...base,
      {
        inspection_result_id: "a0000000-0000-4000-8000-000000000099",
        status: "ok",
        category_snapshot: "Brakes & Tires",
        item_name_snapshot: BRAKE_INSPECTION_SKIP_ITEM,
      },
    ]);
    expect(required.map((r) => r.category)).toEqual([
      "inspection_forks",
      "inspection_item",
    ]);
  });

  it("reports missing photos until present", () => {
    const missing = getMissingInspectionPhotos(base, [
      { category: "inspection_tires" },
      { category: "inspection_brakes" },
    ]);
    expect(missing.map((m) => m.category)).toEqual([
      "inspection_forks",
      "inspection_item",
    ]);

    expect(() =>
      assertInspectionPhotosComplete(base, [
        { category: "inspection_tires" },
        { category: "inspection_brakes" },
        { category: "inspection_forks" },
        {
          category: "inspection_item",
          inspection_result_id: "a0000000-0000-4000-8000-000000000004",
        },
      ])
    ).not.toThrow();

    expect(() => assertInspectionPhotosComplete(base, [])).toThrow(
      "INSPECTION_PHOTOS_REQUIRED"
    );
  });
});
