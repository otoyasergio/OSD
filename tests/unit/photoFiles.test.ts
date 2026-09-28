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

  it("keeps photos whose filename is empty — iOS library picks often have no name", () => {
    const formData = new FormData();
    formData.append("file", new File(["jpeg-bytes"], "", { type: "image/jpeg" }));

    expect(collectPhotoFiles(formData)).toHaveLength(1);
    expect(collectPhotoFiles(formData)[0].size).toBeGreaterThan(0);
  });

  it("keeps Blob-like parts that Next.js reconstructs without instanceof File", () => {
    const formData = new FormData();
    const blob = new Blob(["jpeg-bytes"], { type: "image/jpeg" });
    Object.defineProperty(blob, "name", { value: "from-ios.jpg" });
    const getAll = formData.getAll.bind(formData);
    formData.getAll = ((name: string) =>
      name === "file" ? [blob] : getAll(name)) as FormData["getAll"];

    const files = collectPhotoFiles(formData);
    expect(files).toHaveLength(1);
    expect(files[0].size).toBeGreaterThan(0);
  });
});
