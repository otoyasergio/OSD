import { describe, expect, it } from "vitest";
import {
  groupInspectionPhotosByResult,
  inspectionPhotosForCategory,
  photoViewUrl,
} from "@/lib/inspections/groupInspectionPhotos";

describe("groupInspectionPhotosByResult", () => {
  it("keeps every photo linked to a flagged item, not only the first", () => {
    const resultId = "result-1";
    const grouped = groupInspectionPhotosByResult([
      {
        photo_id: "a",
        category: "inspection_item",
        inspection_result_id: resultId,
        signed_url: "https://cdn.example/a.jpg",
      },
      {
        photo_id: "b",
        category: "inspection_item",
        inspection_result_id: resultId,
        signed_url: "https://cdn.example/b.jpg",
      },
      {
        photo_id: "c",
        category: "inspection_item",
        inspection_result_id: "result-2",
        signed_url: "https://cdn.example/c.jpg",
      },
    ]);

    expect(grouped.get(resultId)?.map((photo) => photo.photo_id)).toEqual(["a", "b"]);
    expect(grouped.get("result-2")).toHaveLength(1);
  });
});

describe("inspectionPhotosForCategory", () => {
  it("returns every tires photo instead of replacing the first", () => {
    const photos = inspectionPhotosForCategory(
      [
        {
          photo_id: "t1",
          category: "inspection_tires",
          inspection_result_id: null,
          signed_url: "https://cdn.example/t1.jpg",
        },
        {
          photo_id: "t2",
          category: "inspection_tires",
          inspection_result_id: null,
          signed_url: "https://cdn.example/t2.jpg",
        },
        {
          photo_id: "b1",
          category: "inspection_brakes",
          inspection_result_id: null,
          signed_url: "https://cdn.example/b1.jpg",
        },
      ],
      "inspection_tires"
    );

    expect(photos.map((photo) => photo.photo_id)).toEqual(["t1", "t2"]);
  });
});

describe("photoViewUrl", () => {
  it("prefers the signed URL and skips empty records", () => {
    expect(
      photoViewUrl({ signed_url: "https://cdn.example/a.jpg", photo_url: "/a.jpg" })
    ).toBe("https://cdn.example/a.jpg");
    expect(photoViewUrl({ signed_url: null, photo_url: null })).toBeNull();
  });
});
