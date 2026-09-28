import type { CompressImageOptions } from "@/lib/forms/compressImageForUpload";
import { UNREADABLE_PHOTO_MESSAGE } from "@/lib/forms/photoUploadErrors";
import { preparePhotoFileForUpload } from "@/lib/forms/preparePhotoFileForUpload";

/**
 * Clone/compress files from a file input, then clear it.
 *
 * Must run before `input.value = ""`. iOS Safari photo-library File objects
 * often become unreadable the moment the input is reset, and they can report
 * `size === 0` until the bytes are read.
 */
export async function readPickedPhotoFiles(
  input: HTMLInputElement,
  options?: CompressImageOptions
): Promise<File[]> {
  const originals = Array.from(input.files ?? []).filter(
    (file) => typeof file?.arrayBuffer === "function"
  );

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
    input.value = "";
  }
}
