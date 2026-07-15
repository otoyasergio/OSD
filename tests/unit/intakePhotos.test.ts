import { describe, expect, it } from "vitest";
import {
  CREATE_INTAKE_PHOTO_SLOTS,
  REQUIRED_PHOTO_CATEGORIES,
} from "@/lib/status/labels";
import { allRequiredIntakeSelected } from "@/components/forms/IntakePhotoSlots";
import { mergeOptionalIntakePhotos } from "@/components/forms/OptionalIntakePhotos";
import { pickPrimaryIntakePhoto } from "@/lib/services/photos";

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

  it("never lets optional photos satisfy one of the six required slots", () => {
    const onlyOptional = {
      other: new File(["x"], "damage.jpg", { type: "image/jpeg" }),
    };
    expect(allRequiredIntakeSelected(onlyOptional)).toBe(false);
  });

  it("adds multiple optional photos and filters empty or duplicate picks", () => {
    const first = new File(["front"], "extra-1.jpg", {
      type: "image/jpeg",
      lastModified: 1,
    });
    const duplicate = new File(["front"], "extra-1.jpg", {
      type: "image/jpeg",
      lastModified: 1,
    });
    const second = new File(["rear"], "extra-2.jpg", {
      type: "image/jpeg",
      lastModified: 2,
    });
    const empty = new File([], "empty.jpg", { type: "image/jpeg" });

    expect(mergeOptionalIntakePhotos([first], [duplicate, second, empty])).toEqual([
      first,
      second,
    ]);
  });

  it("pickPrimaryIntakePhoto prefers front over other angles", () => {
    const primary = pickPrimaryIntakePhoto([
      {
        photo_id: "1",
        storage_path: "a.jpg",
        category: "rear",
        created_at: "2026-01-01T00:00:00Z",
      },
      {
        photo_id: "2",
        storage_path: "b.jpg",
        category: "front",
        created_at: "2026-01-02T00:00:00Z",
      },
      {
        photo_id: "3",
        storage_path: "c.jpg",
        category: "left_side",
        created_at: "2026-01-03T00:00:00Z",
      },
    ]);
    expect(primary?.photo_id).toBe("2");
  });

  it("pickPrimaryIntakePhoto falls back to oldest when no preferred angle", () => {
    const primary = pickPrimaryIntakePhoto([
      {
        photo_id: "vin",
        storage_path: "vin.jpg",
        category: "vin",
        created_at: "2026-01-02T00:00:00Z",
      },
      {
        photo_id: "odo",
        storage_path: "odo.jpg",
        category: "odometer",
        created_at: "2026-01-01T00:00:00Z",
      },
    ]);
    expect(primary?.photo_id).toBe("odo");
  });
});
