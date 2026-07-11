import { describe, expect, it } from "vitest";
import {
  appendIntakePhotosToFormData,
  stripIntakePhotoFields,
} from "@/lib/forms/intakeFormData";
import type { PhotoCategory } from "@/lib/database/types";

const CATEGORIES: PhotoCategory[] = [
  "front",
  "rear",
  "left_side",
  "right_side",
  "vin",
  "odometer",
];

describe("intake FormData helpers", () => {
  it("appends React-state Files so clipped wizard inputs cannot drop photos", () => {
    const formData = new FormData();
    formData.set("mileage", "1200");
    // Simulate empty/zero-size DOM file inputs after leaving the photos step
    formData.set(
      "intake_front",
      new File([], "empty.jpg", { type: "image/jpeg" })
    );

    const photos = Object.fromEntries(
      CATEGORIES.map((category) => [
        category,
        new File([`bytes-${category}`], `${category}.jpg`, {
          type: "image/jpeg",
        }),
      ])
    );

    appendIntakePhotosToFormData(formData, photos, CATEGORIES);

    for (const category of CATEGORIES) {
      const file = formData.get(`intake_${category}`);
      expect(file).toBeInstanceOf(File);
      expect((file as File).size).toBeGreaterThan(0);
      expect((file as File).name).toBe(`${category}.jpg`);
    }
    expect(formData.get("mileage")).toBe("1200");
  });

  it("strips intake photo fields so create-only requests stay under body limits", () => {
    const formData = new FormData();
    formData.set("motorcycle_id", "abc");
    for (const category of CATEGORIES) {
      formData.set(
        `intake_${category}`,
        new File(["x"], `${category}.jpg`, { type: "image/jpeg" })
      );
    }

    stripIntakePhotoFields(formData, CATEGORIES);

    expect(formData.get("motorcycle_id")).toBe("abc");
    for (const category of CATEGORIES) {
      expect(formData.get(`intake_${category}`)).toBeNull();
    }
  });
});
