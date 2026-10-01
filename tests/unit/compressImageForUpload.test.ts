import { describe, expect, it } from "vitest";
import {
  BIKE_PHOTO_COMPRESS,
  DOCUMENT_IMAGE_COMPRESS,
  MAX_CANVAS_AREA,
  compressImageForUpload,
  fitDimensions,
  fitEncodedImage,
  type EncodeImage,
} from "@/lib/forms/compressImageForUpload";
import { SERVER_ACTION_UPLOAD_MAX_BYTES } from "@/lib/forms/uploadLimits";

/**
 * Fake JPEG encoder: output size scales with pixel count and quality, the way
 * a real encoder roughly does. Records every attempt so tests can assert the
 * ladder order.
 */
function fakeEncoder(bytesPerPixelAtFullQuality: number) {
  const calls: { width: number; height: number; quality: number; size: number }[] = [];
  const encode: EncodeImage = async (width, height, quality) => {
    const size = Math.round(width * height * bytesPerPixelAtFullQuality * quality);
    calls.push({ width, height, quality, size });
    return new Blob([new Uint8Array(size)], { type: "image/jpeg" });
  };
  return { encode, calls };
}

describe("compression targets stay under the Server Action request cap", () => {
  it("bike photos compress below the per-request upload limit", () => {
    expect(BIKE_PHOTO_COMPRESS.maxBytes).toBeLessThanOrEqual(
      SERVER_ACTION_UPLOAD_MAX_BYTES
    );
  });

  it("document images compress below the per-request upload limit", () => {
    expect(DOCUMENT_IMAGE_COMPRESS.maxBytes).toBeLessThanOrEqual(
      SERVER_ACTION_UPLOAD_MAX_BYTES
    );
  });
});

describe("fitDimensions", () => {
  it("caps the longest edge and keeps the aspect ratio", () => {
    expect(fitDimensions({ width: 8064, height: 6048 }, 4096)).toEqual({
      width: 4096,
      height: 3072,
    });
    expect(fitDimensions({ width: 3024, height: 4032 }, 4096)).toEqual({
      width: 3024,
      height: 4032,
    });
  });

  it("never upscales", () => {
    expect(fitDimensions({ width: 640, height: 480 }, 4096)).toEqual({
      width: 640,
      height: 480,
    });
  });

  it("keeps portrait iPhone shots at their native size instead of stretching to the long edge", () => {
    // 12 MP portrait: the old resizeWidth decode hint blew this up to 4096×5461.
    expect(fitDimensions({ width: 3024, height: 4032 }, 4096)).toEqual({
      width: 3024,
      height: 4032,
    });
    // 24 MP portrait (iPhone 15/16 default) scales on the long edge only.
    expect(fitDimensions({ width: 4284, height: 5712 }, 4096)).toEqual({
      width: 3072,
      height: 4096,
    });
  });

  it("stays under the iOS 17 canvas area limit for square and near-square shots", () => {
    const square = fitDimensions({ width: 6000, height: 6000 }, 4096);
    expect(square.width * square.height).toBeLessThanOrEqual(MAX_CANVAS_AREA);
    expect(square.width).toBe(square.height);
    expect(square.width).toBe(4000);

    const nearSquare = fitDimensions({ width: 5000, height: 4500 }, 4096);
    expect(nearSquare.width * nearSquare.height).toBeLessThanOrEqual(MAX_CANVAS_AREA);
    expect(nearSquare.width / nearSquare.height).toBeCloseTo(5000 / 4500, 2);

    // Ordinary 4:3 and 3:4 camera frames are already well under it.
    expect(fitDimensions({ width: 5712, height: 4284 }, 4096)).toEqual({
      width: 4096,
      height: 3072,
    });
    expect(MAX_CANVAS_AREA).toBeLessThan(16_777_216);
  });
});

describe("fitEncodedImage", () => {
  const options = {
    maxBytes: 3_500_000,
    maxDimension: 4096,
    quality: 0.9,
    minQuality: 0.82,
  };

  it("returns the first encode when it already fits", async () => {
    const { encode, calls } = fakeEncoder(0.1);
    const fitted = await fitEncodedImage(encode, { width: 4032, height: 3024 }, options);
    expect(fitted).not.toBeNull();
    expect(calls).toHaveLength(1);
    expect(fitted?.quality).toBe(0.9);
    expect(fitted?.width).toBe(4032);
  });

  it("lowers quality to the floor before touching dimensions", async () => {
    // 12.19 MP × 0.33 B/px: ~3.62 MB at q0.9 (too big), ~3.30 MB at q0.82 (fits).
    const { encode, calls } = fakeEncoder(0.33);
    const fitted = await fitEncodedImage(encode, { width: 4032, height: 3024 }, options);
    expect(calls.map((call) => call.quality)).toEqual([0.9, 0.82]);
    expect(calls.every((call) => call.width === 4032)).toBe(true);
    expect(fitted?.blob.size).toBeLessThanOrEqual(options.maxBytes);
    expect(fitted?.quality).toBe(0.82);
  });

  it("steps dimensions down once the quality floor is not enough, and fits", async () => {
    // ~0.6 bytes/px at full quality: a detailed 12 MP shot that is ~6 MB at q0.82.
    const { encode, calls } = fakeEncoder(0.6);
    const fitted = await fitEncodedImage(encode, { width: 4032, height: 3024 }, options);
    expect(fitted).not.toBeNull();
    expect(fitted!.blob.size).toBeLessThanOrEqual(options.maxBytes);
    // Quality never goes below the floor; the dimension shrinks instead.
    expect(calls.every((call) => call.quality >= options.minQuality - 1e-9)).toBe(true);
    expect(fitted!.width).toBeLessThan(4032);
    expect(fitted!.width).toBeGreaterThan(2000);
    // Aspect ratio is preserved.
    expect(fitted!.width / fitted!.height).toBeCloseTo(4032 / 3024, 2);
    // Converges quickly instead of shaving 15% forever.
    expect(calls.length).toBeLessThanOrEqual(5);
  });

  it("applies the dimension cap before the first encode", async () => {
    const { encode, calls } = fakeEncoder(0.05);
    await fitEncodedImage(encode, { width: 8064, height: 6048 }, options);
    expect(calls[0]).toMatchObject({ width: 4096, height: 3072 });
  });

  it("returns the smallest encode instead of looping forever when nothing fits", async () => {
    // Absurd 40 bytes per pixel so even 640px is over the cap.
    const { encode, calls } = fakeEncoder(40);
    const fitted = await fitEncodedImage(encode, { width: 4032, height: 3024 }, options);
    expect(fitted).not.toBeNull();
    expect(calls.length).toBeLessThanOrEqual(10);
    const smallest = Math.min(...calls.map((call) => call.size));
    expect(fitted!.blob.size).toBe(smallest);
    expect(Math.max(fitted!.width, fitted!.height)).toBeGreaterThanOrEqual(640);
  });

  it("returns null when the encoder produces nothing", async () => {
    const fitted = await fitEncodedImage(
      async () => null,
      { width: 100, height: 100 },
      options
    );
    expect(fitted).toBeNull();
  });
});

describe("compressImageForUpload", () => {
  it("returns the original file when it is already small enough", async () => {
    const small = new File(["tiny"], "shot.jpg", { type: "image/jpeg" });
    const result = await compressImageForUpload(small, { maxBytes: 1024 * 1024 });
    expect(result).toBe(small);
  });

  it("never returns an empty file", async () => {
    // A non-image blob should fall back to the original rather than blank output.
    const weird = new File(["not-an-image"], "notes.bin", {
      type: "application/octet-stream",
    });
    const result = await compressImageForUpload(weird, {
      maxBytes: 1,
      maxDimension: 64,
    });
    expect(result.size).toBeGreaterThan(0);
  });
});
