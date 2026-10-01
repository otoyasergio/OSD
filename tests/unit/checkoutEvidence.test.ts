import { describe, expect, it } from "vitest";
import type { PhotoCategory } from "@/lib/database/types";
import {
  CHECKOUT_EVIDENCE_OVERRIDE_REASON_MAX_LENGTH,
  CHECKOUT_PHOTO_CATEGORIES,
  checkoutCapturePreconditions,
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

describe("checkoutCapturePreconditions", () => {
  const completedJobs = [{ status: "completed" }, { status: "cancelled" }];

  it("requires every active job completed and both QC columns", () => {
    expect(
      checkoutCapturePreconditions({
        jobs: completedJobs,
        qualityCheckedAt: "2026-10-01T12:00:00.000Z",
        qualityCheckedByUserId: "user-1",
      })
    ).toEqual({ jobsComplete: true, qcComplete: true });
  });

  it("treats a lone QC timestamp or actor as incomplete, matching the capture gate", () => {
    expect(
      checkoutCapturePreconditions({
        jobs: completedJobs,
        qualityCheckedAt: "2026-10-01T12:00:00.000Z",
        qualityCheckedByUserId: null,
      })
    ).toEqual({ jobsComplete: true, qcComplete: false });
    expect(
      checkoutCapturePreconditions({
        jobs: completedJobs,
        qualityCheckedAt: null,
        qualityCheckedByUserId: "user-1",
      })
    ).toEqual({ jobsComplete: true, qcComplete: false });
  });

  it("treats in-progress or empty active jobs as incomplete", () => {
    expect(
      checkoutCapturePreconditions({
        jobs: [{ status: "in_progress" }],
        qualityCheckedAt: "2026-10-01T12:00:00.000Z",
        qualityCheckedByUserId: "user-1",
      }).jobsComplete
    ).toBe(false);
    expect(
      checkoutCapturePreconditions({
        jobs: [{ status: "cancelled" }],
        qualityCheckedAt: "2026-10-01T12:00:00.000Z",
        qualityCheckedByUserId: "user-1",
      }).jobsComplete
    ).toBe(false);
  });

  it("shares the 500-character override cap with UI and validation", () => {
    expect(CHECKOUT_EVIDENCE_OVERRIDE_REASON_MAX_LENGTH).toBe(500);
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
