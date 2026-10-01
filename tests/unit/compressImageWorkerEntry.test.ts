import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  CompressWorkerRequest,
  CompressWorkerResponse,
} from "@/lib/forms/compressImage.worker";

const OPTIONS = {
  maxBytes: 3_500_000,
  maxDimension: 4096,
  quality: 0.9,
  minQuality: 0.82,
};

/** Evaluate the worker entry against a scripted `self`. */
async function loadWorkerEntry() {
  const listeners: ((event: { data: unknown }) => void)[] = [];
  const posted: CompressWorkerResponse[] = [];
  vi.stubGlobal("self", {
    addEventListener: (_type: string, listener: (event: { data: unknown }) => void) => {
      listeners.push(listener);
    },
    postMessage: (message: CompressWorkerResponse) => {
      posted.push(message);
    },
  });
  vi.resetModules();
  await import("@/lib/forms/compressImage.worker");
  return {
    posted,
    listeners,
    dispatch(data: unknown) {
      for (const listener of listeners) listener({ data });
    },
  };
}

function installImagePipeline({ decodeFails = false } = {}) {
  vi.stubGlobal("createImageBitmap", async () => {
    if (decodeFails)
      throw new DOMException("The operation is not supported.", "InvalidStateError");
    return { width: 4032, height: 3024, close() {} };
  });
  vi.stubGlobal(
    "OffscreenCanvas",
    class {
      constructor(
        public width: number,
        public height: number
      ) {}
      getContext() {
        return { drawImage() {} };
      }
      async convertToBlob({ quality }: { quality: number }) {
        const size = Math.round(this.width * this.height * 0.1 * quality);
        return new Blob([new Uint8Array(size)], { type: "image/jpeg" });
      }
    }
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("compressImage.worker entry", () => {
  it("stays inert when evaluated outside a worker (node, server render)", async () => {
    vi.resetModules();
    await expect(import("@/lib/forms/compressImage.worker")).resolves.toBeDefined();
  });

  it("registers a single message listener on the worker scope", async () => {
    const { listeners } = await loadWorkerEntry();
    expect(listeners).toHaveLength(1);
  });

  it("answers each request with a JPEG blob keyed by the request id", async () => {
    installImagePipeline();
    const { dispatch, posted } = await loadWorkerEntry();
    const request: CompressWorkerRequest = {
      id: 7,
      file: new Blob(["photo"], { type: "image/heic" }),
      options: OPTIONS,
    };
    dispatch(request);
    await vi.waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toMatchObject({
      id: 7,
      ok: true,
      width: 4032,
      height: 3024,
      quality: 0.9,
    });
    const reply = posted[0];
    expect(reply.ok && reply.blob instanceof Blob).toBe(true);
    expect(reply.ok && reply.blob!.size).toBeLessThanOrEqual(OPTIONS.maxBytes);
  });

  it("reports decode failures as an error reply instead of killing the worker", async () => {
    installImagePipeline({ decodeFails: true });
    const { dispatch, posted } = await loadWorkerEntry();
    dispatch({ id: 3, file: new Blob(["x"]), options: OPTIONS });
    await vi.waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toEqual({
      id: 3,
      ok: false,
      error: "The operation is not supported.",
    });

    // Still alive for the next photo.
    installImagePipeline();
    dispatch({ id: 4, file: new Blob(["x"]), options: OPTIONS });
    await vi.waitFor(() => expect(posted).toHaveLength(2));
    expect(posted[1]).toMatchObject({ id: 4, ok: true });
  });

  it("reports a realm without OffscreenCanvas as blob null so the page falls back", async () => {
    vi.stubGlobal("createImageBitmap", async () => ({ width: 1, height: 1, close() {} }));
    const { dispatch, posted } = await loadWorkerEntry();
    dispatch({ id: 1, file: new Blob(["x"]), options: OPTIONS });
    await vi.waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toEqual({
      id: 1,
      ok: true,
      blob: null,
      width: 0,
      height: 0,
      quality: 0,
    });
  });

  it("ignores messages that are not compression requests", async () => {
    installImagePipeline();
    const { dispatch, posted } = await loadWorkerEntry();
    dispatch(null);
    dispatch({});
    dispatch({ id: "nope", file: new Blob(["x"]), options: OPTIONS });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(posted).toHaveLength(0);
  });
});
