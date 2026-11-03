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
    expect(isInspectionReadOnly({ ...editable, work_order_status: "completed" })).toBe(
      true
    );
    expect(isInspectionReadOnly({ ...editable, work_order_status: "cancelled" })).toBe(
      true
    );
  });

  it("is read-only for foreign locations and viewers without edit rights", () => {
    expect(isInspectionReadOnly({ ...editable, is_foreign_location: true })).toBe(true);
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

  it("does not waive brakes until the skip line has a real reason", () => {
    const rows = [
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
        status: "ok" as const,
        category_snapshot: "Brakes & Tires",
        item_name_snapshot: BRAKE_INSPECTION_SKIP_ITEM,
        notes: "ok",
      },
      {
        status: null,
        category_snapshot: "Battery",
        item_name_snapshot: "Check Condition of Battery",
      },
    ];
    expect(countIncompleteInspectionResults(rows)).toBe(4);
    expect(
      countIncompleteInspectionResults([
        ...rows.slice(0, 2),
        {
          ...rows[2],
          notes: "Customer declined a brake and tire inspection this visit.",
        },
        rows[3],
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

  it("keeps an attention item open until it has a description", () => {
    const item = {
      status: "immediate_attention" as const,
      category_snapshot: "Battery",
      item_name_snapshot: "Check Condition of Battery",
    };
    expect(countIncompleteInspectionResults([{ ...item, notes: "   " }])).toBe(1);
    expect(
      countIncompleteInspectionResults([
        { ...item, notes: "Cell is swollen and will not hold a charge." },
      ])
    ).toBe(0);
  });

  it("lets OK stand without a note and rejects a blank or lazy N/A", () => {
    expect(
      countIncompleteInspectionResults([
        {
          status: "ok",
          notes: null,
          category_snapshot: "Battery",
          item_name_snapshot: "Battery Terminal / Cables / Mountings",
        },
      ])
    ).toBe(0);
    expect(
      countIncompleteInspectionResults([
        {
          status: "not_applicable",
          notes: "n/a",
          category_snapshot: "Frame, Chassis, and Suspension",
          item_name_snapshot: "Chain or Belt (Tension, Lubrication, and Sprockets)",
        },
      ])
    ).toBe(1);
    expect(
      countIncompleteInspectionResults([
        {
          status: "not_applicable",
          notes: "Shaft drive, no chain or belt.",
          category_snapshot: "Frame, Chassis, and Suspension",
          item_name_snapshot: "Chain or Belt (Tension, Lubrication, and Sprockets)",
        },
      ])
    ).toBe(0);
  });

  it("keeps a measured line open until a number is entered", () => {
    const item = {
      status: "ok" as const,
      category_snapshot: "Brakes & Tires — Front",
      item_name_snapshot: "Front tire tread",
      requires_measurement: true,
      notes: null,
    };
    expect(countIncompleteInspectionResults([{ ...item, measurement: null }])).toBe(1);
    expect(countIncompleteInspectionResults([{ ...item, measurement: "good" }])).toBe(1);
    expect(countIncompleteInspectionResults([{ ...item, measurement: "4" }])).toBe(0);
  });

  it("requires a real acknowledgment instead of a bare OK", () => {
    const item = {
      status: "ok" as const,
      category_snapshot: "Comments / Damage",
      item_name_snapshot: "Customer acknowledgment",
    };
    expect(countIncompleteInspectionResults([{ ...item, notes: "ok" }])).toBe(1);
    expect(
      countIncompleteInspectionResults([
        { ...item, notes: "Customer signed the drop-off sheet at the counter." },
      ])
    ).toBe(0);
  });

  it("counts a waived brake section from the full checklist, not one column", () => {
    const front = {
      inspection_result_id: "front",
      status: null,
      category_snapshot: "Brakes & Tires — Front",
      item_name_snapshot: "Front spokes",
    };
    const skip = {
      inspection_result_id: "skip",
      status: "ok" as const,
      category_snapshot: "Brakes & Tires",
      item_name_snapshot: BRAKE_INSPECTION_SKIP_ITEM,
      notes: "Customer declined a brake and tire inspection this visit.",
    };
    expect(countIncompleteInspectionResults([front, skip], { within: [front] })).toBe(0);
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
      item_name_snapshot: "Front Forks (oil, smooth travel, equal air pressure/damping)",
    },
    {
      inspection_result_id: "a0000000-0000-4000-8000-000000000004",
      status: "immediate_attention" as string | null,
      category_snapshot: "Battery",
      item_name_snapshot: "Check Condition of Battery (Storage Capacity Test)",
    },
  ];

  it("requires separate front tire, front brake, forks, and battery photos", () => {
    const required = getRequiredInspectionPhotos(base);
    expect(required.map((requirement) => requirement.label)).toEqual([
      "Front tire photo",
      "Front brake photo",
      "Forks photo",
      "Battery photo",
    ]);
    expect(
      required.every((requirement) => requirement.category === "inspection_item")
    ).toBe(true);
    expect(
      required.find((requirement) => requirement.label === "Front tire photo")
        ?.inspection_result_id
    ).toBe("a0000000-0000-4000-8000-000000000001");
  });

  it("does not let one combined tire photo cover the front tire", () => {
    const missing = getMissingInspectionPhotos(base, [
      { category: "inspection_tires" },
      { category: "inspection_brakes" },
    ]);
    expect(missing.map((requirement) => requirement.label)).toEqual([
      "Front tire photo",
      "Front brake photo",
      "Forks photo",
      "Battery photo",
    ]);
  });

  it("accepts a forks section photo and an item photo on each evidence line", () => {
    expect(() =>
      assertInspectionPhotosComplete(base, [
        {
          category: "inspection_item",
          inspection_result_id: "a0000000-0000-4000-8000-000000000001",
        },
        {
          category: "inspection_item",
          inspection_result_id: "a0000000-0000-4000-8000-000000000002",
        },
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

  it("waives unanswered tire and brake photos only after a real skip reason", () => {
    const unanswered = [
      {
        inspection_result_id: "a0000000-0000-4000-8000-000000000011",
        status: null,
        category_snapshot: "Brakes & Tires — Front",
        item_name_snapshot: "Front tire tread",
      },
      {
        inspection_result_id: "a0000000-0000-4000-8000-000000000012",
        status: null,
        category_snapshot: "Brakes & Tires — Rear",
        item_name_snapshot: "Rear brake lining",
      },
      {
        inspection_result_id: "a0000000-0000-4000-8000-000000000013",
        status: "ok" as const,
        category_snapshot: "Brakes & Tires",
        item_name_snapshot: BRAKE_INSPECTION_SKIP_ITEM,
        notes: "ok",
      },
    ];
    expect(
      getRequiredInspectionPhotos(unanswered).map((requirement) => requirement.label)
    ).toEqual(["Front tire photo", "Rear brake photo"]);
    expect(
      getRequiredInspectionPhotos([
        ...unanswered.slice(0, 2),
        {
          ...unanswered[2],
          notes: "Customer declined a brake and tire inspection this visit.",
        },
      ]).map((requirement) => requirement.label)
    ).toEqual([]);
  });

  it("still requires a tire photo when that end was marked and then skipped", () => {
    const required = getRequiredInspectionPhotos([
      ...base,
      {
        inspection_result_id: "a0000000-0000-4000-8000-000000000099",
        status: "ok",
        notes: "Customer declined a brake and tire inspection this visit.",
        category_snapshot: "Brakes & Tires",
        item_name_snapshot: BRAKE_INSPECTION_SKIP_ITEM,
      },
    ]);
    expect(required.map((requirement) => requirement.label)).toContain(
      "Front tire photo"
    );
  });

  it("drops a side photo when that line does not apply, and asks for a chain photo once it is OK", () => {
    const rows = [
      {
        inspection_result_id: "a0000000-0000-4000-8000-000000000021",
        status: "not_applicable" as const,
        notes: "Covered bike, left side not visible.",
        category_snapshot: "Comments / Damage",
        item_name_snapshot: "Prior paint, chrome, or trim damage — Left side",
      },
      {
        inspection_result_id: "a0000000-0000-4000-8000-000000000022",
        status: "ok" as const,
        category_snapshot: "Frame, Chassis, and Suspension",
        item_name_snapshot: "Chain or Belt (Tension, Lubrication, and Sprockets)",
      },
    ];
    expect(
      getRequiredInspectionPhotos(rows).map((requirement) => requirement.label)
    ).toEqual(["Chain or belt photo"]);
    expect(
      getRequiredInspectionPhotos([
        rows[0],
        { ...rows[1], status: "not_applicable", notes: "Shaft drive, no chain or belt." },
      ])
    ).toEqual([]);
  });

  it("asks for a photo of any other line marked for attention", () => {
    const required = getRequiredInspectionPhotos([
      {
        inspection_result_id: "a0000000-0000-4000-8000-000000000031",
        status: "future_attention",
        category_snapshot: "Lights, Lenses, Controls and Misc.",
        item_name_snapshot:
          "Throttle (Moves easy, springs closed, no revving when turning handlebars)",
      },
    ]);
    expect(required.map((requirement) => requirement.label)).toEqual([
      "Photo: Throttle (Moves easy, springs closed, no revving when turning handlebars)",
    ]);
  });
});
