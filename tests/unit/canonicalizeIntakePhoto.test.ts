import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  canonicalizeIntakePhoto,
  makeCanonicalIntakeThumbnail,
} from "@/lib/photos/canonicalizeIntakePhoto";

describe("canonicalizeIntakePhoto", () => {
  it("validates an in-bounds, correctly oriented JPEG without re-encoding it", async () => {
    const source = await sharp({
      create: {
        width: 1280,
        height: 960,
        channels: 3,
        background: "#334155",
      },
    })
      .jpeg({ quality: 92 })
      .toBuffer();

    const result = await canonicalizeIntakePhoto(source);

    expect(Buffer.from(result.bytes).equals(source)).toBe(true);
    expect(result).toMatchObject({
      width: 1280,
      height: 960,
      contentType: "image/jpeg",
      byteSize: source.byteLength,
    });
  });

  it.each(["png", "webp"] as const)(
    "converts oversized %s input to an exact, in-bounds JPEG",
    async (format) => {
      let pipeline = sharp({
        create: {
          width: 5000,
          height: 1200,
          channels: 3,
          background: "#0f766e",
        },
      });
      pipeline = format === "png" ? pipeline.png() : pipeline.webp();
      const source = await pipeline.toBuffer();

      const result = await canonicalizeIntakePhoto(source);
      const metadata = await sharp(result.bytes).metadata();

      expect(metadata.format).toBe("jpeg");
      expect(Math.max(result.width, result.height)).toBeLessThanOrEqual(4096);
      expect(metadata.width).toBe(result.width);
      expect(metadata.height).toBe(result.height);
      expect(result.contentType).toBe("image/jpeg");
      expect(result.byteSize).toBe(result.bytes.byteLength);
    }
  );

  it("builds the 480px JPEG thumbnail from canonical bytes", async () => {
    const source = await sharp({
      create: {
        width: 1600,
        height: 1200,
        channels: 3,
        background: "#7c3aed",
      },
    })
      .png()
      .toBuffer();
    const canonical = await canonicalizeIntakePhoto(source);

    const thumb = await makeCanonicalIntakeThumbnail(canonical.bytes);
    const metadata = await sharp(thumb).metadata();

    expect(metadata.format).toBe("jpeg");
    expect(Math.max(metadata.width ?? 0, metadata.height ?? 0)).toBeLessThanOrEqual(480);
  });
});
