import { describe, expect, it } from "vitest";
import { toLightboxPhotos } from "@/lib/photos/lightbox";

describe("toLightboxPhotos", () => {
  it("prefers signed_url over photo_url", () => {
    const result = toLightboxPhotos([
      {
        photo_id: "p1",
        signed_url: "https://signed.example/p1",
        photo_url: "https://public.example/p1",
        category: "front",
        notes: null,
      },
    ]);
    expect(result).toEqual([
      {
        id: "p1",
        src: "https://signed.example/p1",
        label: "Front",
        caption: null,
      },
    ]);
  });

  it("falls back to photo_url when no signed url", () => {
    const result = toLightboxPhotos([
      {
        photo_id: "p2",
        signed_url: null,
        photo_url: "https://public.example/p2",
        category: "damage",
        notes: "Scratch on tank",
      },
    ]);
    expect(result[0]?.src).toBe("https://public.example/p2");
    expect(result[0]?.caption).toBe("Scratch on tank");
  });

  it("drops photos without any viewable URL", () => {
    const result = toLightboxPhotos([
      { photo_id: "p3", signed_url: null, photo_url: null, category: "rear" },
      {
        photo_id: "p4",
        signed_url: "https://signed.example/p4",
        category: "rear",
      },
    ]);
    expect(result.map((p) => p.id)).toEqual(["p4"]);
  });

  it("uses the raw category as label when unknown", () => {
    const result = toLightboxPhotos([
      {
        photo_id: "p5",
        signed_url: "https://signed.example/p5",
        category: "mystery_category",
      },
    ]);
    expect(result[0]?.label).toBe("mystery_category");
  });
});
