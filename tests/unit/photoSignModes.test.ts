import { describe, expect, it } from "vitest";
import { photoFullUrl, photoPreviewUrl } from "@/lib/photos/urls";
import { pathsToSignForIntakePhotos } from "@/lib/services/photos";

const photo = {
  storage_path: "wo/full.jpg",
  thumb_storage_path: "wo/thumb.jpg",
};

describe("pathsToSignForIntakePhotos", () => {
  it("signs nothing in none mode", () => {
    expect(pathsToSignForIntakePhotos([photo], "none")).toEqual([]);
  });

  it("signs only the preview path in thumbs mode", () => {
    expect(pathsToSignForIntakePhotos([photo], "thumbs")).toEqual(["wo/thumb.jpg"]);
    expect(
      pathsToSignForIntakePhotos([{ storage_path: "wo/full.jpg" }], "thumbs")
    ).toEqual(["wo/full.jpg"]);
  });

  it("signs full and thumb in all mode", () => {
    expect(pathsToSignForIntakePhotos([photo], "all")).toEqual([
      "wo/full.jpg",
      "wo/thumb.jpg",
    ]);
  });
});

describe("photo URL helpers", () => {
  it("uses the thumb when no full signed URL exists", () => {
    const row = {
      signed_url: null,
      photo_url: null,
      thumb_url: "https://signed.example/t.jpg",
    };
    expect(photoFullUrl(row)).toBe("https://signed.example/t.jpg");
    expect(photoPreviewUrl(row)).toBe("https://signed.example/t.jpg");
  });

  it("prefers the full signed URL over the thumb", () => {
    expect(
      photoFullUrl({
        signed_url: "https://signed.example/full.jpg",
        thumb_url: "https://signed.example/t.jpg",
      })
    ).toBe("https://signed.example/full.jpg");
  });
});
