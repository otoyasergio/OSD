import type { CompressImageOptions, FittedImage } from "@/lib/forms/imageFit";
import type {
  CompressWorkerRequest,
  CompressWorkerResponse,
} from "@/lib/forms/compressImage.worker";

/**
 * Main-thread side of the compression worker.
 *
 * Decoding a 12–24 MP capture and running the JPEG encode ladder takes a few
 * hundred milliseconds to several seconds on an iPad or iPhone. On the main
 * thread that freezes the form (no scrolling, no taps, "Uploading…" never
 * repaints) and on iOS long stalls can get the tab reloaded. Safari 16.4+,
 * Chrome and Firefox all run `createImageBitmap` + `OffscreenCanvas` inside
 * Web Workers, so the heavy lifting moves there and the page stays responsive.
 *
 * Failure semantics: resolves `null` when this browser cannot do the work in a
 * worker, rejects when the worker crashes or stalls. Either way the caller
 * falls back to the `<canvas>` path on the main thread.
 */

/** Generous: an older iPad decoding a 24 MP HEIC plus up to 10 encodes. */
export const WORKER_COMPRESS_TIMEOUT_MS = 45_000;
/** Terminate once a batch is done so the decoded bitmaps' memory is released. */
export const WORKER_IDLE_MS = 15_000;

export function supportsWorkerCompression(): boolean {
  return (
    typeof Worker === "function" &&
    typeof OffscreenCanvas === "function" &&
    typeof createImageBitmap === "function"
  );
}

type Pending = {
  resolve: (value: FittedImage | null) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

let worker: Worker | null = null;
let idleTimer: ReturnType<typeof setTimeout> | null = null;
let nextId = 1;
const pending = new Map<number, Pending>();

function spawn(): Worker {
  // webpack and Turbopack emit the worker as its own chunk from this exact
  // `new Worker(new URL("./file", import.meta.url))` shape — keep it literal.
  const created = new Worker(new URL("./compressImage.worker.ts", import.meta.url));
  created.onmessage = (event: MessageEvent<CompressWorkerResponse>) => {
    settle(event.data);
  };
  created.onerror = (event) => {
    const message =
      typeof event === "object" && event && "message" in event
        ? String((event as { message?: unknown }).message || "")
        : "";
    discardWorker(new Error(message || "WORKER_FAILED"));
  };
  created.onmessageerror = () => {
    discardWorker(new Error("WORKER_MESSAGE_FAILED"));
  };
  return created;
}

function settle(response: CompressWorkerResponse | undefined) {
  if (!response || typeof response.id !== "number") return;
  const entry = pending.get(response.id);
  if (!entry) return;
  pending.delete(response.id);
  clearTimeout(entry.timer);

  if (response.ok) {
    entry.resolve(
      response.blob
        ? {
            blob: response.blob,
            width: response.width,
            height: response.height,
            quality: response.quality,
          }
        : null
    );
  } else {
    entry.reject(new Error(response.error || "WORKER_FAILED"));
  }
  scheduleIdleShutdown();
}

function discardWorker(error: Error) {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
  worker?.terminate();
  worker = null;

  const failed = Array.from(pending.values());
  pending.clear();
  for (const entry of failed) {
    clearTimeout(entry.timer);
    entry.reject(error);
  }
}

function scheduleIdleShutdown() {
  if (!worker || pending.size > 0) return;
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    idleTimer = null;
    if (pending.size === 0) {
      worker?.terminate();
      worker = null;
    }
  }, WORKER_IDLE_MS);
}

/**
 * Compress `file` in the shared worker. Posting a `File` is a cheap handle
 * transfer, not a copy; the returned JPEG `Blob` comes back the same way.
 */
export function compressInWorker(
  file: Blob,
  options: Required<CompressImageOptions>
): Promise<FittedImage | null> {
  if (!supportsWorkerCompression()) return Promise.resolve(null);

  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
  let active: Worker;
  try {
    active = worker ?? (worker = spawn());
  } catch (error) {
    return Promise.reject(error instanceof Error ? error : new Error("WORKER_FAILED"));
  }

  const id = nextId++;
  return new Promise<FittedImage | null>((resolve, reject) => {
    const timer = setTimeout(() => {
      // A wedged worker would stall every later photo too; start fresh.
      if (pending.has(id)) discardWorker(new Error("WORKER_TIMEOUT"));
    }, WORKER_COMPRESS_TIMEOUT_MS);
    pending.set(id, { resolve, reject, timer });

    const request: CompressWorkerRequest = { id, file, options };
    try {
      active.postMessage(request);
    } catch (error) {
      pending.delete(id);
      clearTimeout(timer);
      reject(error instanceof Error ? error : new Error("WORKER_FAILED"));
    }
  });
}

/** Tear the worker down now (tests, or when leaving a photo-heavy screen). */
export function terminateCompressionWorker() {
  discardWorker(new Error("WORKER_TERMINATED"));
}
