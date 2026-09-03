import { describe, expect, it } from "vitest";
import { collectPhotoFiles } from "@/lib/forms/photoFiles";

describe("collectPhotoFiles", () => {
  it("collects every non-empty file from a multi-photo upload", () => {
    const formData = new FormData();
    formData.append("file", new File(["one"], "a.jpg", { type: "image/jpeg" }));
    formData.append("file", new File(["two"], "b.jpg", { type: "image/jpeg" }));
    formData.append("file", new File([], "empty.jpg", { type: "image/jpeg" }));

    expect(collectPhotoFiles(formData).map((file) => file.name)).toEqual([
      "a.jpg",
      "b.jpg",
    ]);
  });

  it("returns an empty list when no photo was chosen", () => {
    expect(collectPhotoFiles(new FormData())).toEqual([]);
  });
});
