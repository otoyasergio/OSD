import type { CompressImageOptions } from "@/lib/forms/compressImageForUpload";
import { UNREADABLE_PHOTO_MESSAGE } from "@/lib/forms/photoUploadErrors";
import { preparePhotoFileForUpload } from "@/lib/forms/preparePhotoFileForUpload";
import {
  isCameraPhotoInput,
  savePhotosToCameraRoll,
} from "@/lib/forms/savePhotosToCameraRoll";

export type ReadPickedPhotoFilesOptions = CompressImageOptions & {
  /** Override camera detection — tests pass a spy here. */
  saveToCameraRoll?: boolean;
  savePhotos?: (files: File[]) => void | Promise<void>;
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
  const archive =
    shouldSave && originals.length > 0
      ? Promise.resolve(save(originals))
      : Promise.resolve();

  try {
    if (originals.length === 0) return [];

    const prepared: File[] = [];
    for (const file of originals) {
      try {
        const next = await preparePhotoFileForUpload(file, options);
        if (next.size > 0) prepared.push(next);
      } catch {
        // Skip a truly empty part; throw below if nothing usable remains.
      }
    }

    if (prepared.length === 0) {
      throw new Error(UNREADABLE_PHOTO_MESSAGE);
    }
    return prepared;
  } finally {
    try {
      await archive;
    } catch {
      // Device save is best-effort — the upload still proceeds.
    }
    input.value = "";
  }
}
