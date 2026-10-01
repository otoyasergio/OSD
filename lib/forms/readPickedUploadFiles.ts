import type { CompressImageOptions } from "@/lib/forms/compressImageForUpload";
import { mapWithConcurrency } from "@/lib/forms/mapWithConcurrency";
import { PickedFileError, UNREADABLE_PHOTO_MESSAGE } from "@/lib/forms/photoUploadErrors";
import { preparePickedFileForUpload } from "@/lib/forms/preparePickedFileForUpload";
import { emitPhotoTelemetry, type PhotoTelemetrySurface } from "@/lib/photos/telemetry";

export type ReadPickedUploadFilesOptions = CompressImageOptions & {
  surface?: PhotoTelemetrySurface;
};

function emitPrepareFailed(
  surface: PhotoTelemetrySurface | undefined,
  error: unknown
): void {
  const errorCode =
    error instanceof PickedFileError
      ? error.code
      : error instanceof Error && /empty/i.test(error.message)
        ? "empty"
        : "unreadable";
  emitPhotoTelemetry({
    name: "photo_prepare_failed",
    surface: surface ?? "unknown",
    errorCode,
  });
}

/**
 * Clone/prepare image or PDF files from a file input, then clear it.
 * Input is reset only after the bytes are independent of the picker.
 */
export async function readPickedUploadFiles(
  input: HTMLInputElement,
  options?: ReadPickedUploadFilesOptions
): Promise<File[]> {
  const originals = Array.from(input.files ?? []).filter(
    (file) => typeof file?.arrayBuffer === "function"
  );

  try {
    if (originals.length === 0) return [];

    const failures: unknown[] = [];
    const prepared = (
      await mapWithConcurrency(originals, 2, async (file) => {
        try {
          const next = await preparePickedFileForUpload(file, options);
          return next.size > 0 ? next : null;
        } catch (error) {
          failures.push(error);
          return null;
        }
      })
    ).filter((file): file is File => file !== null);

    if (prepared.length === 0) {
      const error = failures[0] ?? new PickedFileError("empty");
      emitPrepareFailed(options?.surface, error);
      throw error instanceof PickedFileError ? error : new PickedFileError("unreadable");
    }
    return prepared;
  } finally {
    input.value = "";
  }
}

export { UNREADABLE_PHOTO_MESSAGE };
