import { describe, expect, it } from "vitest";
import {
  CREATE_INTAKE_PHOTO_SLOTS,
  REQUIRED_PHOTO_CATEGORIES,
} from "@/lib/status/labels";
import { allRequiredIntakeSelected } from "@/components/forms/IntakePhotoSlots";

describe("required intake photo slots", () => {
  it("defines exactly six create-time slots with expected categories", () => {
    expect(CREATE_INTAKE_PHOTO_SLOTS).toHaveLength(6);
    expect(CREATE_INTAKE_PHOTO_SLOTS.map((s) => s.category)).toEqual([
      "front",
      "rear",
      "left_side",
      "right_side",
      "vin",
      "odometer",
    ]);
    expect(CREATE_INTAKE_PHOTO_SLOTS.map((s) => s.category).sort()).toEqual(
      [...REQUIRED_PHOTO_CATEGORIES].sort()
    );
  });

  it("uses human-readable dash/odometer label", () => {
    const odometer = CREATE_INTAKE_PHOTO_SLOTS.find(
      (s) => s.category === "odometer"
    );
    expect(odometer?.label).toMatch(/dash/i);
    expect(odometer?.label).toMatch(/mileage/i);
  });

  it("allRequiredIntakeSelected requires a non-empty File per category", () => {
    const empty = allRequiredIntakeSelected({});
    expect(empty).toBe(false);

    const files = Object.fromEntries(
      CREATE_INTAKE_PHOTO_SLOTS.map((slot) => [
        slot.category,
        new File(["x"], `${slot.category}.jpg`, { type: "image/jpeg" }),
      ])
    );
    expect(allRequiredIntakeSelected(files)).toBe(true);

    const missingVin = { ...files, vin: null };
    expect(allRequiredIntakeSelected(missingVin)).toBe(false);
  });
});
