import { afterEach, describe, expect, it, vi } from "vitest";
import {
  compressWithOffscreenCanvas,
  decodeImageBitmap,
  hasOffscreenImagePipeline,
} from "@/lib/forms/offscreenCompress";
import { redrawOnResize } from "@/lib/forms/imageFit";

const OPTIONS = {
  maxBytes: 3_500_000,
  maxDimension: 4096,
  quality: 0.9,
  minQuality: 0.82,
};

type FakeBitmap = { width: number; height: number; close: () => void };

/**
 * Stand-ins for the browser APIs the worker relies on. `bytesPerPixel` makes
 * the fake encoder produce output that scales with pixel count and quality.
 */
function installOffscreenStubs({
  width,
  height,
  bytesPerPixel,
  orientedDecodeThrows = false,
  contextAvailable = true,
  encodeRejects = false,
}: {
  width: number;
  height: number;
  bytesPerPixel: number;
  orientedDecodeThrows?: boolean;
  contextAvailable?: boolean;
  encodeRejects?: boolean;
}) {
  const close = vi.fn();
  const bitmap: FakeBitmap = { width, height, close };
  const decodeCalls: unknown[][] = [];
  const createImageBitmap = vi.fn(async (...args: unknown[]) => {
    decodeCalls.push(args);
    if (orientedDecodeThrows && args.length > 1) {
      throw new TypeError("Type error");
    }
    return bitmap;
  });

  const draws: { width: number; height: number }[] = [];
  const encodes: { width: number; height: number; quality: number }[] = [];

  class FakeOffscreenCanvas {
    width: number;
    height: number;
    constructor(width: number, height: number) {
      this.width = width;
      this.height = height;
    }
    getContext(kind: string) {
      if (kind !== "2d" || !contextAvailable) return null;
      return {
        drawImage: (_source: unknown, _x: number, _y: number, w: number, h: number) => {
          draws.push({ width: w, height: h });
        },
      };
    }
    async convertToBlob({ quality }: { type: string; quality: number }) {
      encodes.push({ width: this.width, height: this.height, quality });
      if (encodeRejects) throw new DOMException("encode failed", "EncodingError");
      const size = Math.round(this.width * this.height * bytesPerPixel * quality);
      return new Blob([new Uint8Array(size)], { type: "image/jpeg" });
    }
  }

  vi.stubGlobal("createImageBitmap", createImageBitmap);
  vi.stubGlobal("OffscreenCanvas", FakeOffscreenCanvas);
  return { close, decodeCalls, draws, encodes };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("hasOffscreenImagePipeline", () => {
  it("is false in node, where neither API exists", () => {
    expect(hasOffscreenImagePipeline()).toBe(false);
  });

  it("is true once both createImageBitmap and OffscreenCanvas exist", () => {
    installOffscreenStubs({ width: 10, height: 10, bytesPerPixel: 1 });
    expect(hasOffscreenImagePipeline()).toBe(true);
  });
});

describe("decodeImageBitmap", () => {
  it("asks for EXIF orientation first", async () => {
    const { decodeCalls } = installOffscreenStubs({
      width: 4032,
      height: 3024,
      bytesPerPixel: 0.1,
    });
    const file = new Blob(["x"], { type: "image/jpeg" });
    await decodeImageBitmap(file);
    expect(decodeCalls).toEqual([[file, { imageOrientation: "from-image" }]]);
  });

  it("falls back to a plain decode when the browser rejects the orientation option (Safari < 16)", async () => {
    const { decodeCalls } = installOffscreenStubs({
      width: 4032,
      height: 3024,
      bytesPerPixel: 0.1,
      orientedDecodeThrows: true,
    });
    const file = new Blob(["x"], { type: "image/jpeg" });
    await decodeImageBitmap(file);
    expect(decodeCalls).toHaveLength(2);
    expect(decodeCalls[1]).toEqual([file]);
  });
});

describe("compressWithOffscreenCanvas", () => {
  it("returns null without the APIs so the caller can use the DOM path", async () => {
    const result = await compressWithOffscreenCanvas(new Blob(["x"]), OPTIONS);
    expect(result).toBeNull();
  });

  it("encodes a fitting photo in one pass and releases the bitmap", async () => {
    const { close, draws, encodes } = installOffscreenStubs({
      width: 4032,
      height: 3024,
      bytesPerPixel: 0.1,
    });
    const result = await compressWithOffscreenCanvas(new Blob(["x"]), OPTIONS);
    expect(result).not.toBeNull();
    expect(result!.width).toBe(4032);
    expect(result!.height).toBe(3024);
    expect(result!.quality).toBe(0.9);
    expect(result!.blob.size).toBeLessThanOrEqual(OPTIONS.maxBytes);
    expect(draws).toEqual([{ width: 4032, height: 3024 }]);
    expect(encodes).toHaveLength(1);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("re-encodes without redrawing while only the quality changes", async () => {
    // ~3.62 MB at q0.9, ~3.30 MB at q0.82: quality ladder only, one draw.
    const { draws, encodes } = installOffscreenStubs({
      width: 4032,
      height: 3024,
      bytesPerPixel: 0.33,
    });
    const result = await compressWithOffscreenCanvas(new Blob(["x"]), OPTIONS);
    expect(result!.quality).toBe(0.82);
    expect(encodes.map((e) => e.quality)).toEqual([0.9, 0.82]);
    expect(draws).toHaveLength(1);
  });

  it("redraws from the decoded bitmap when the dimensions step down", async () => {
    const { draws, encodes } = installOffscreenStubs({
      width: 4032,
      height: 3024,
      bytesPerPixel: 0.6,
    });
    const result = await compressWithOffscreenCanvas(new Blob(["x"]), OPTIONS);
    expect(result!.blob.size).toBeLessThanOrEqual(OPTIONS.maxBytes);
    expect(result!.width).toBeLessThan(4032);
    // One draw per distinct size, not per encode.
    const sizes = new Set(encodes.map((e) => `${e.width}x${e.height}`));
    expect(draws).toHaveLength(sizes.size);
    expect(encodes.length).toBeGreaterThan(draws.length);
  });

  it("caps the first draw at the dimension and canvas-area limits", async () => {
    const { draws } = installOffscreenStubs({
      width: 6000,
      height: 6000,
      bytesPerPixel: 0.05,
    });
    await compressWithOffscreenCanvas(new Blob(["x"]), OPTIONS);
    expect(draws[0]).toEqual({ width: 4000, height: 4000 });
  });

  it("returns null and still closes the bitmap when no 2d context is available", async () => {
    const { close } = installOffscreenStubs({
      width: 100,
      height: 100,
      bytesPerPixel: 1,
      contextAvailable: false,
    });
    const result = await compressWithOffscreenCanvas(new Blob(["x"]), OPTIONS);
    expect(result).toBeNull();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("returns null when the canvas refuses to encode", async () => {
    const { close } = installOffscreenStubs({
      width: 100,
      height: 100,
      bytesPerPixel: 1,
      encodeRejects: true,
    });
    const result = await compressWithOffscreenCanvas(new Blob(["x"]), OPTIONS);
    expect(result).toBeNull();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("closes the bitmap even when decoding yields an empty image", async () => {
    const { close, encodes } = installOffscreenStubs({
      width: 0,
      height: 0,
      bytesPerPixel: 1,
    });
    const result = await compressWithOffscreenCanvas(new Blob(["x"]), OPTIONS);
    expect(result).toBeNull();
    expect(encodes).toHaveLength(0);
    expect(close).toHaveBeenCalledTimes(1);
  });
});

describe("redrawOnResize", () => {
  it("draws once per distinct size and encodes every time", async () => {
    const draws: string[] = [];
    const encodes: string[] = [];
    const encode = redrawOnResize(
      (w, h) => {
        draws.push(`${w}x${h}`);
      },
      async (w, h, q) => {
        encodes.push(`${w}x${h}@${q}`);
        return new Blob(["x"]);
      }
    );
    await encode(100, 50, 0.9);
    await encode(100, 50, 0.82);
    await encode(80, 40, 0.82);
    expect(draws).toEqual(["100x50", "80x40"]);
    expect(encodes).toEqual(["100x50@0.9", "100x50@0.82", "80x40@0.82"]);
  });
});
