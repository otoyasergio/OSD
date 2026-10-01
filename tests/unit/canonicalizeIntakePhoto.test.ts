import { readFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  canonicalizeIntakePhoto,
  makeCanonicalIntakeThumbnail,
} from "@/lib/photos/canonicalizeIntakePhoto";

function heifHeader(brand = "heic"): Buffer {
  const bytes = Buffer.alloc(32, 0);
  bytes.write("ftyp", 4, "ascii");
  bytes.write(brand, 8, "ascii");
  return bytes;
}

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

  it("rejects invalid HEIC/HEIF bytes as PHOTO_TYPE_INVALID", async () => {
    await expect(canonicalizeIntakePhoto(heifHeader("heic"))).rejects.toThrow(
      "PHOTO_TYPE_INVALID"
    );
    await expect(canonicalizeIntakePhoto(heifHeader("mif1"))).rejects.toThrow(
      "PHOTO_TYPE_INVALID"
    );
  });

  it("rejects a warning-level corrupted JPEG instead of keeping it", async () => {
    const source = await sharp({
      create: {
        width: 800,
        height: 600,
        channels: 3,
        background: "#334155",
      },
    })
      .jpeg({ quality: 90 })
      .toBuffer();
    const corrupted = Buffer.from(source);
    corrupted.fill(0x20, corrupted.length - 200, corrupted.length - 2);

    await expect(canonicalizeIntakePhoto(corrupted)).rejects.toThrow(
      "PHOTO_TYPE_INVALID"
    );
  });

  it("rotates an EXIF-oriented JPEG and returns exact metadata", async () => {
    const source = await sharp({
      create: {
        width: 800,
        height: 400,
        channels: 3,
        background: "#b45309",
      },
    })
      .withMetadata({ orientation: 6 })
      .jpeg({ quality: 90 })
      .toBuffer();

    const result = await canonicalizeIntakePhoto(source);
    const metadata = await sharp(result.bytes).metadata();

    expect(metadata.format).toBe("jpeg");
    expect(result.width).toBe(400);
    expect(result.height).toBe(800);
    expect(metadata.width).toBe(400);
    expect(metadata.height).toBe(800);
    expect(result.contentType).toBe("image/jpeg");
    expect(result.byteSize).toBe(result.bytes.byteLength);
    expect(metadata.orientation == null || metadata.orientation === 1).toBe(true);
  });

  it("converts a representative real HEIC fixture to an exact JPEG", async () => {
    const source = readFileSync(join(process.cwd(), "tests/fixtures/photos/sample.heic"));

    const result = await canonicalizeIntakePhoto(source);
    const metadata = await sharp(result.bytes).metadata();

    expect(metadata.format).toBe("jpeg");
    expect(Math.max(result.width, result.height)).toBeLessThanOrEqual(4096);
    expect(metadata.width).toBe(result.width);
    expect(metadata.height).toBe(result.height);
    expect(result.contentType).toBe("image/jpeg");
    expect(result.byteSize).toBe(result.bytes.byteLength);
    expect(result.width).toBeGreaterThan(0);
    expect(result.height).toBeGreaterThan(0);
  });
});
