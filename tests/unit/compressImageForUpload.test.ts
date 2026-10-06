import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BIKE_PHOTO_COMPRESS,
  DOCUMENT_IMAGE_COMPRESS,
  MAX_CANVAS_AREA,
  compressImageForUpload,
  fitDimensions,
  fitEncodedImage,
  supportsWorkerCompression,
  type EncodeImage,
} from "@/lib/forms/compressImageForUpload";
import { isBrowserOffline, resetBrowserOnlineForTests } from "@/lib/forms/browserOnline";
import { terminateCompressionWorker } from "@/lib/forms/compressImageWorker";
import type { CompressWorkerResponse } from "@/lib/forms/compressImage.worker";
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

describe("compressImageForUpload in a browser with Web Workers", () => {
  /**
   * Auto-replying stand-in for the bundled worker. `script` decides how each
   * posted photo is answered; a `null` reply simulates a worker crash.
   */
  function installAutoWorker(
    script: (request: { id: number; file: Blob }) => CompressWorkerResponse | null
  ) {
    const spawned: { url: string; posted: number }[] = [];
    class AutoWorker {
      onmessage: ((event: { data: CompressWorkerResponse }) => void) | null = null;
      onerror: ((event: { message: string }) => void) | null = null;
      onmessageerror: (() => void) | null = null;
      private readonly record: { url: string; posted: number };
      constructor(url: URL | string) {
        this.record = { url: String(url), posted: 0 };
        spawned.push(this.record);
      }
      postMessage(request: { id: number; file: Blob }) {
        this.record.posted += 1;
        queueMicrotask(() => {
          const reply = script(request);
          if (reply) this.onmessage?.({ data: reply });
          else this.onerror?.({ message: "Script error." });
        });
      }
      terminate() {}
    }
    vi.stubGlobal("Worker", AutoWorker);
    vi.stubGlobal("OffscreenCanvas", class {});
    vi.stubGlobal("createImageBitmap", async () => ({ width: 1, height: 1, close() {} }));
    return spawned;
  }

  const heic = new File([new Uint8Array(5_000_000)], "IMG_0001.heic", {
    type: "image/heic",
    lastModified: 1_700_000_000_000,
  });

  afterEach(() => {
    terminateCompressionWorker();
    resetBrowserOnlineForTests();
    vi.unstubAllGlobals();
  });

  it("is off in node and on once Worker, OffscreenCanvas and createImageBitmap exist", () => {
    expect(supportsWorkerCompression()).toBe(false);
    installAutoWorker(() => null);
    expect(supportsWorkerCompression()).toBe(true);
  });

  it("returns the worker's JPEG as a .jpg File without touching the DOM", async () => {
    const encoded = new Blob([new Uint8Array(2_000_000)], { type: "image/jpeg" });
    const spawned = installAutoWorker(({ id }) => ({
      id,
      ok: true,
      blob: encoded,
      width: 4032,
      height: 3024,
      quality: 0.82,
    }));

    const result = await compressImageForUpload(heic);
    expect(result.name).toBe("IMG_0001.jpg");
    expect(result.type).toBe("image/jpeg");
    expect(result.size).toBe(encoded.size);
    expect(result.lastModified).toBe(heic.lastModified);
    expect(spawned).toHaveLength(1);
    expect(spawned[0].url).toMatch(/compressImage\.worker\.ts$/);
    expect(typeof document).toBe("undefined");
  });

  it("does not spawn a worker while the browser is offline", async () => {
    const spawned = installAutoWorker(({ id }) => ({
      id,
      ok: true,
      blob: new Blob([new Uint8Array(10)], { type: "image/jpeg" }),
      width: 1,
      height: 1,
      quality: 0.9,
    }));
    vi.stubGlobal("navigator", { onLine: false });

    const result = await compressImageForUpload(heic);

    expect(spawned).toHaveLength(0);
    expect(result).toBe(heic);
  });

  it("does not spawn a worker after a window offline event even if navigator.onLine stays true", async () => {
    const spawned = installAutoWorker(({ id }) => ({
      id,
      ok: true,
      blob: new Blob([new Uint8Array(10)], { type: "image/jpeg" }),
      width: 1,
      height: 1,
      quality: 0.9,
    }));
    const target = new EventTarget();
    vi.stubGlobal("window", target);
    vi.stubGlobal("navigator", { onLine: true });
    expect(isBrowserOffline()).toBe(false);
    target.dispatchEvent(new Event("offline"));

    const result = await compressImageForUpload(heic);

    expect(spawned).toHaveLength(0);
    expect(result).toBe(heic);
  });

  it("skips the worker entirely for JPEGs that already fit", async () => {
    const spawned = installAutoWorker(() => null);
    const small = new File([new Uint8Array(1000)], "ok.jpg", { type: "image/jpeg" });
    expect(await compressImageForUpload(small)).toBe(small);
    expect(spawned).toHaveLength(0);
  });

  it("falls back to the original file when the worker crashes and there is no DOM", async () => {
    installAutoWorker(() => null);
    const result = await compressImageForUpload(heic);
    expect(result).toBe(heic);
  });

  it("falls back when the worker reports it cannot encode in its realm", async () => {
    installAutoWorker(({ id }) => ({
      id,
      ok: true,
      blob: null,
      width: 0,
      height: 0,
      quality: 0,
    }));
    const result = await compressImageForUpload(heic);
    expect(result).toBe(heic);
  });

  it("reuses one worker for a batch of photos", async () => {
    const spawned = installAutoWorker(({ id }) => ({
      id,
      ok: true,
      blob: new Blob([new Uint8Array(10)], { type: "image/jpeg" }),
      width: 1,
      height: 1,
      quality: 0.9,
    }));
    await Promise.all([
      compressImageForUpload(heic),
      compressImageForUpload(heic),
      compressImageForUpload(heic),
    ]);
    expect(spawned).toHaveLength(1);
    expect(spawned[0].posted).toBe(3);
  });
});
