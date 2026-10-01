import { afterEach, describe, expect, it, vi } from "vitest";
import {
  WORKER_COMPRESS_TIMEOUT_MS,
  WORKER_IDLE_MS,
  compressInWorker,
  supportsWorkerCompression,
  terminateCompressionWorker,
} from "@/lib/forms/compressImageWorker";
import type { CompressWorkerResponse } from "@/lib/forms/compressImage.worker";

const OPTIONS = {
  maxBytes: 3_500_000,
  maxDimension: 4096,
  quality: 0.9,
  minQuality: 0.82,
};

type Posted = { id: number; file: Blob; options: typeof OPTIONS };

/** Scriptable stand-in for the browser's Worker: tests drive every reply. */
class FakeWorker {
  static instances: FakeWorker[] = [];
  readonly url: string;
  readonly posted: Posted[] = [];
  onmessage: ((event: { data: CompressWorkerResponse }) => void) | null = null;
  onerror: ((event: { message?: string }) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  terminate = vi.fn();
  postMessage = vi.fn((message: Posted) => {
    this.posted.push(message);
  });

  constructor(url: URL | string) {
    this.url = String(url);
    FakeWorker.instances.push(this);
  }

  reply(response: CompressWorkerResponse) {
    this.onmessage?.({ data: response });
  }

  crash(message = "boom") {
    this.onerror?.({ message });
  }
}

function installWorkerStubs() {
  vi.stubGlobal("Worker", FakeWorker);
  vi.stubGlobal("OffscreenCanvas", class {});
  vi.stubGlobal("createImageBitmap", async () => ({ width: 1, height: 1, close() {} }));
}

const jpeg = (size: number) => new Blob([new Uint8Array(size)], { type: "image/jpeg" });
const file = new File(["photo"], "IMG_0001.heic", { type: "image/heic" });

afterEach(() => {
  terminateCompressionWorker();
  FakeWorker.instances = [];
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("supportsWorkerCompression", () => {
  it("is false in node, where there is no Worker or OffscreenCanvas", () => {
    expect(supportsWorkerCompression()).toBe(false);
  });

  it("needs Worker, OffscreenCanvas and createImageBitmap together", () => {
    vi.stubGlobal("Worker", FakeWorker);
    vi.stubGlobal("createImageBitmap", async () => ({}));
    expect(supportsWorkerCompression()).toBe(false);
    vi.stubGlobal("OffscreenCanvas", class {});
    expect(supportsWorkerCompression()).toBe(true);
  });
});

describe("compressInWorker", () => {
  it("resolves null without touching Worker when the browser cannot run the pipeline", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    await expect(compressInWorker(file, OPTIONS)).resolves.toBeNull();
    expect(FakeWorker.instances).toHaveLength(0);
  });

  it("spawns the bundled worker and posts the file with the resolved options", async () => {
    installWorkerStubs();
    const promise = compressInWorker(file, OPTIONS);
    expect(FakeWorker.instances).toHaveLength(1);
    const worker = FakeWorker.instances[0];
    expect(worker.url).toMatch(/compressImage\.worker\.ts$/);
    expect(worker.posted).toHaveLength(1);
    expect(worker.posted[0]).toMatchObject({ file, options: OPTIONS });
    expect(typeof worker.posted[0].id).toBe("number");

    const blob = jpeg(1200);
    worker.reply({
      id: worker.posted[0].id,
      ok: true,
      blob,
      width: 4032,
      height: 3024,
      quality: 0.82,
    });
    await expect(promise).resolves.toEqual({
      blob,
      width: 4032,
      height: 3024,
      quality: 0.82,
    });
  });

  it("resolves null when the worker's realm could not encode, so the caller falls back", async () => {
    installWorkerStubs();
    const promise = compressInWorker(file, OPTIONS);
    const worker = FakeWorker.instances[0];
    worker.reply({
      id: worker.posted[0].id,
      ok: true,
      blob: null,
      width: 0,
      height: 0,
      quality: 0,
    });
    await expect(promise).resolves.toBeNull();
  });

  it("rejects with the worker's error message when decoding fails there", async () => {
    installWorkerStubs();
    const promise = compressInWorker(file, OPTIONS);
    const worker = FakeWorker.instances[0];
    worker.reply({
      id: worker.posted[0].id,
      ok: false,
      error: "The operation is not supported.",
    });
    await expect(promise).rejects.toThrow("The operation is not supported.");
  });

  it("shares one worker across concurrent photos and matches replies by id", async () => {
    installWorkerStubs();
    const first = compressInWorker(file, OPTIONS);
    const second = compressInWorker(file, OPTIONS);
    expect(FakeWorker.instances).toHaveLength(1);
    const worker = FakeWorker.instances[0];
    const [a, b] = worker.posted;
    expect(a.id).not.toBe(b.id);

    const blobB = jpeg(2);
    const blobA = jpeg(1);
    worker.reply({
      id: b.id,
      ok: true,
      blob: blobB,
      width: 20,
      height: 10,
      quality: 0.9,
    });
    worker.reply({ id: a.id, ok: true, blob: blobA, width: 10, height: 5, quality: 0.9 });
    await expect(first).resolves.toMatchObject({ blob: blobA, width: 10 });
    await expect(second).resolves.toMatchObject({ blob: blobB, width: 20 });
  });

  it("ignores replies for unknown ids and malformed messages", async () => {
    installWorkerStubs();
    const promise = compressInWorker(file, OPTIONS);
    const worker = FakeWorker.instances[0];
    worker.reply({
      id: 999_999,
      ok: true,
      blob: jpeg(1),
      width: 1,
      height: 1,
      quality: 1,
    });
    worker.onmessage?.({ data: undefined as unknown as CompressWorkerResponse });
    const blob = jpeg(5);
    worker.reply({
      id: worker.posted[0].id,
      ok: true,
      blob,
      width: 1,
      height: 1,
      quality: 1,
    });
    await expect(promise).resolves.toMatchObject({ blob });
  });

  it("fails every pending photo when the worker crashes and spawns a fresh one next time", async () => {
    installWorkerStubs();
    const first = compressInWorker(file, OPTIONS);
    const second = compressInWorker(file, OPTIONS);
    const worker = FakeWorker.instances[0];
    worker.crash("Script error.");
    await expect(first).rejects.toThrow("Script error.");
    await expect(second).rejects.toThrow("Script error.");
    expect(worker.terminate).toHaveBeenCalledTimes(1);

    const third = compressInWorker(file, OPTIONS);
    expect(FakeWorker.instances).toHaveLength(2);
    const replacement = FakeWorker.instances[1];
    const blob = jpeg(3);
    replacement.reply({
      id: replacement.posted[0].id,
      ok: true,
      blob,
      width: 1,
      height: 1,
      quality: 1,
    });
    await expect(third).resolves.toMatchObject({ blob });
  });

  it("gives up on a wedged worker after the timeout and terminates it", async () => {
    vi.useFakeTimers();
    installWorkerStubs();
    const promise = compressInWorker(file, OPTIONS);
    const worker = FakeWorker.instances[0];
    vi.advanceTimersByTime(WORKER_COMPRESS_TIMEOUT_MS - 1);
    expect(worker.terminate).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    await expect(promise).rejects.toThrow("WORKER_TIMEOUT");
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it("terminates an idle worker to hand its memory back, then respawns on demand", async () => {
    vi.useFakeTimers();
    installWorkerStubs();
    const promise = compressInWorker(file, OPTIONS);
    const worker = FakeWorker.instances[0];
    worker.reply({
      id: worker.posted[0].id,
      ok: true,
      blob: jpeg(1),
      width: 1,
      height: 1,
      quality: 1,
    });
    await promise;

    vi.advanceTimersByTime(WORKER_IDLE_MS - 1);
    expect(worker.terminate).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(worker.terminate).toHaveBeenCalledTimes(1);

    const again = compressInWorker(file, OPTIONS);
    expect(FakeWorker.instances).toHaveLength(2);
    const replacement = FakeWorker.instances[1];
    replacement.reply({
      id: replacement.posted[0].id,
      ok: true,
      blob: jpeg(1),
      width: 1,
      height: 1,
      quality: 1,
    });
    await again;
  });

  it("keeps the worker alive while another photo is still in flight", async () => {
    vi.useFakeTimers();
    installWorkerStubs();
    const first = compressInWorker(file, OPTIONS);
    const second = compressInWorker(file, OPTIONS);
    const worker = FakeWorker.instances[0];
    worker.reply({
      id: worker.posted[0].id,
      ok: true,
      blob: jpeg(1),
      width: 1,
      height: 1,
      quality: 1,
    });
    await first;
    vi.advanceTimersByTime(WORKER_IDLE_MS * 2);
    expect(worker.terminate).not.toHaveBeenCalled();
    worker.reply({
      id: worker.posted[1].id,
      ok: true,
      blob: jpeg(1),
      width: 1,
      height: 1,
      quality: 1,
    });
    await second;
  });

  it("rejects cleanly when the message cannot be posted, without leaking the request", async () => {
    installWorkerStubs();
    const failing = compressInWorker(file, OPTIONS);
    const worker = FakeWorker.instances[0];
    // Simulate a DataCloneError on the next post only.
    worker.postMessage.mockImplementationOnce(() => {
      throw new DOMException("could not clone", "DataCloneError");
    });
    const broken = compressInWorker(file, OPTIONS);
    await expect(broken).rejects.toThrow("could not clone");

    worker.reply({
      id: worker.posted[0].id,
      ok: true,
      blob: jpeg(1),
      width: 1,
      height: 1,
      quality: 1,
    });
    await expect(failing).resolves.not.toBeNull();
  });
});
