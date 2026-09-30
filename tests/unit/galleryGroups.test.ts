import { describe, expect, it } from "vitest";
import {
  categoriesForGalleryGroup,
  galleryGroupForCategory,
  photoMatchesGalleryGroup,
  photoMatchesGallerySearch,
} from "@/lib/photos/galleryGroups";

describe("galleryGroupForCategory", () => {
  it("maps intake angles to intake", () => {
    expect(galleryGroupForCategory("front")).toBe("intake");
    expect(galleryGroupForCategory("damage")).toBe("intake");
  });

  it("maps inspection shots to inspection", () => {
    expect(galleryGroupForCategory("inspection_tires")).toBe("inspection");
    expect(galleryGroupForCategory("inspection_item")).toBe("inspection");
  });

  it("maps job proof and work journal to after", () => {
    expect(galleryGroupForCategory("job_proof")).toBe("after");
    expect(galleryGroupForCategory("job_work")).toBe("after");
  });
});

describe("categoriesForGalleryGroup", () => {
  it("returns null for all so callers skip the category filter", () => {
    expect(categoriesForGalleryGroup("all")).toBeNull();
  });

  it("lists only after categories for the after bucket", () => {
    expect(categoriesForGalleryGroup("after")?.sort()).toEqual(
      ["job_proof", "job_work"].sort()
    );
  });
});

describe("photoMatchesGalleryGroup", () => {
  it("keeps every category when group is all", () => {
    expect(photoMatchesGalleryGroup("front", "all")).toBe(true);
    expect(photoMatchesGalleryGroup("job_proof", "all")).toBe(true);
  });

  it("filters by bucket", () => {
    expect(photoMatchesGalleryGroup("front", "intake")).toBe(true);
    expect(photoMatchesGalleryGroup("front", "after")).toBe(false);
  });
});

describe("photoMatchesGallerySearch", () => {
  const fields = {
    work_order_number: "WO-3601",
    bike_year: 2022,
    bike_make: "Yamaha",
    bike_model: "R3",
    bike_plate: "ABCD12",
    customer_first_name: "Ada",
    customer_last_name: "Lovelace",
  };

  it("matches empty query", () => {
    expect(photoMatchesGallerySearch(fields, "")).toBe(true);
  });

  it("matches WO number, bike, plate, and customer", () => {
    expect(photoMatchesGallerySearch(fields, "3601")).toBe(true);
    expect(photoMatchesGallerySearch(fields, "yamaha")).toBe(true);
    expect(photoMatchesGallerySearch(fields, "abcd")).toBe(true);
    expect(photoMatchesGallerySearch(fields, "lovelace")).toBe(true);
  });

  it("rejects unrelated text", () => {
    expect(photoMatchesGallerySearch(fields, "honda")).toBe(false);
  });
});
