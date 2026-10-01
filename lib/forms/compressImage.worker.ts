import type { CompressImageOptions } from "@/lib/forms/imageFit";
import { compressWithOffscreenCanvas } from "@/lib/forms/offscreenCompress";

/**
 * Web Worker entry: compresses one photo per message off the main thread so
 * decoding a 12–24 MP iPhone capture and the JPEG encode ladder never freeze
 * the form on an iPad or iPhone. Spawned by `lib/forms/compressImageWorker.ts`.
 */

export type CompressWorkerRequest = {
  id: number;
  file: Blob;
  options: Required<CompressImageOptions>;
};

export type CompressWorkerResponse =
  | {
      id: number;
      ok: true;
      /** Null when this worker's realm cannot encode (caller falls back). */
      blob: Blob | null;
      width: number;
      height: number;
      quality: number;
    }
  | { id: number; ok: false; error: string };

type WorkerScope = {
  addEventListener(
    type: "message",
    listener: (event: MessageEvent<CompressWorkerRequest>) => void
  ): void;
  postMessage(message: CompressWorkerResponse): void;
};

async function handle(scope: WorkerScope, request: CompressWorkerRequest) {
  const { id } = request;
  try {
    const fitted = await compressWithOffscreenCanvas(request.file, request.options);
    scope.postMessage(
      fitted
        ? {
            id,
            ok: true,
            blob: fitted.blob,
            width: fitted.width,
            height: fitted.height,
            quality: fitted.quality,
          }
        : { id, ok: true, blob: null, width: 0, height: 0, quality: 0 }
    );
  } catch (error) {
    scope.postMessage({
      id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

// `self` is only defined in a browser realm; the guard keeps the module inert
// if it is ever evaluated in node (tests) or during a server render.
const scope = typeof self === "undefined" ? null : (self as unknown as WorkerScope);

scope?.addEventListener("message", (event) => {
  if (!event.data || typeof event.data.id !== "number") return;
  void handle(scope, event.data);
});
