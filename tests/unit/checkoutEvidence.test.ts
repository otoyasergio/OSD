import { describe, expect, it } from "vitest";
import type { PhotoCategory } from "@/lib/database/types";
import {
  CHECKOUT_PHOTO_CATEGORIES,
  checkoutCoverageFromPhotos,
} from "@/lib/status/checkoutEvidence";
import {
  GENERAL_WORK_ORDER_PHOTO_CATEGORIES,
  PHOTO_CATEGORY_LABELS,
} from "@/lib/status/labels";
import {
  categoriesForGalleryGroup,
  galleryGroupForCategory,
  photoMatchesGalleryGroup,
} from "@/lib/photos/galleryGroups";
import { photoCategorySchema } from "@/lib/validation/schemas";

const FIVE = [
  "checkout_front",
  "checkout_rear",
  "checkout_left_side",
  "checkout_right_side",
  "checkout_odometer",
] as const;

describe("checkout photo categories", () => {
  it("lists the five handoff categories and labels every PhotoCategory", () => {
    expect(CHECKOUT_PHOTO_CATEGORIES).toEqual([...FIVE]);
    for (const category of FIVE) {
      expect(photoCategorySchema.parse(category)).toBe(category);
      expect(PHOTO_CATEGORY_LABELS[category as PhotoCategory]).toMatch(/Checkout/i);
    }
    expect(Object.keys(PHOTO_CATEGORY_LABELS)).toEqual(expect.arrayContaining([...FIVE]));
  });

  it("keeps checkout categories out of the generic Photos-tab upload selector", () => {
    expect(GENERAL_WORK_ORDER_PHOTO_CATEGORIES).toEqual(
      expect.not.arrayContaining([...FIVE])
    );
    expect(GENERAL_WORK_ORDER_PHOTO_CATEGORIES).toContain("front");
    expect(GENERAL_WORK_ORDER_PHOTO_CATEGORIES).toContain("other");
  });
});

describe("checkoutCoverageFromPhotos", () => {
  it("reports exact missing categories across duplicates and mixed rows", () => {
    expect(checkoutCoverageFromPhotos([])).toEqual({
      covered: [],
      missing: [...FIVE],
      complete: false,
    });

    const mixed = checkoutCoverageFromPhotos([
      { category: "front" },
      { category: "checkout_front" },
      { category: "checkout_front" },
      { category: "job_proof" },
      { category: "checkout_rear" },
      { category: "checkout_odometer" },
      { category: null },
      { category: "other" },
    ]);
    expect(mixed.covered).toEqual([
      "checkout_front",
      "checkout_rear",
      "checkout_odometer",
    ]);
    expect(mixed.missing).toEqual(["checkout_left_side", "checkout_right_side"]);
    expect(mixed.complete).toBe(false);
  });

  it("is complete when every checkout category has one or more committed rows", () => {
    expect(checkoutCoverageFromPhotos(FIVE.map((category) => ({ category })))).toEqual({
      covered: [...FIVE],
      missing: [],
      complete: true,
    });
  });
});

describe("checkout gallery grouping", () => {
  it("places all five checkout categories in a distinct checkout group", () => {
    for (const category of FIVE) {
      expect(galleryGroupForCategory(category)).toBe("checkout");
      expect(photoMatchesGalleryGroup(category, "checkout")).toBe(true);
      expect(photoMatchesGalleryGroup(category, "intake")).toBe(false);
      expect(photoMatchesGalleryGroup(category, "after")).toBe(false);
    }
    expect(categoriesForGalleryGroup("checkout")?.sort()).toEqual([...FIVE].sort());
  });
});
