import type { CompressImageOptions } from "@/lib/forms/compressImageForUpload";
import { mapWithConcurrency } from "@/lib/forms/mapWithConcurrency";
import { UNREADABLE_PHOTO_MESSAGE } from "@/lib/forms/photoUploadErrors";
import { preparePhotoFileForUpload } from "@/lib/forms/preparePhotoFileForUpload";
import {
  isCameraPhotoInput,
  savePhotosToCameraRoll,
} from "@/lib/forms/savePhotosToCameraRoll";
import { emitPhotoTelemetry, type PhotoTelemetrySurface } from "@/lib/photos/telemetry";

export type ReadPickedPhotoFilesOptions = CompressImageOptions & {
  /** Override camera detection — tests pass a spy here. */
  saveToCameraRoll?: boolean;
  savePhotos?: (files: File[]) => void | Promise<void>;
  surface?: PhotoTelemetrySurface;
};

/**
 * Clone/compress files from a file input, then clear it.
 *
 * Must run before `input.value = ""`. iOS Safari photo-library File objects
 * often become unreadable the moment the input is reset, and they can report
 * `size === 0` until the bytes are read.
 *
 * Camera captures (`capture` attribute) are also copied to the device so they
 * land in Photos / Downloads — the inline camera does not do that itself.
 * That copy starts in this turn (Safari needs the user gesture) and must not
 * block the upload: the share sheet can sit open while the app and Ask OTOMOTO
 * receive the cloned files.
 */
export async function readPickedPhotoFiles(
  input: HTMLInputElement,
  options?: ReadPickedPhotoFilesOptions
): Promise<File[]> {
  const originals = Array.from(input.files ?? []).filter(
    (file) => typeof file?.arrayBuffer === "function"
  );

  const shouldSave = options?.saveToCameraRoll ?? isCameraPhotoInput(input);
  const save = options?.savePhotos ?? savePhotosToCameraRoll;
  // Start share/download in this turn so Safari still has the user gesture.
  // Do not await it — the sheet must not hold up the app upload.
  let deviceSave: Promise<void> | null = null;
  if (shouldSave && originals.length > 0) {
    try {
      deviceSave = Promise.resolve(save(originals)).then(
        () => undefined,
        () => undefined
      );
    } catch {
      deviceSave = Promise.resolve();
    }
  }

  try {
    if (originals.length === 0) return [];

    const prepared = (
      await mapWithConcurrency(originals, 2, async (file) => {
        try {
          const next = await preparePhotoFileForUpload(file, options);
          return next.size > 0 ? next : null;
        } catch {
          // Skip a truly empty part; throw below if nothing usable remains.
          return null;
        }
      })
    ).filter((file): file is File => file !== null);

    if (prepared.length === 0) {
      const errorCode = originals.every((file) => file.size === 0)
        ? "empty"
        : "unreadable";
      emitPhotoTelemetry({
        name: "photo_prepare_failed",
        surface: options?.surface ?? "unknown",
        errorCode,
      });
      throw new Error(UNREADABLE_PHOTO_MESSAGE);
    }
    return prepared;
  } finally {
    if (deviceSave) {
      // Keep the original File alive until the sheet finishes reading it.
      void deviceSave.finally(() => {
        input.value = "";
      });
    } else {
      input.value = "";
    }
  }
}
