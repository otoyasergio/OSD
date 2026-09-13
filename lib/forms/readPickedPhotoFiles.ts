import type { CompressImageOptions } from "@/lib/forms/compressImageForUpload";
import { preparePhotoFileForUpload } from "@/lib/forms/preparePhotoFileForUpload";

/**
 * Clone/compress files from a file input, then clear it.
 *
 * Must run before `input.value = ""`. iOS Safari photo-library File objects
 * often become unreadable the moment the input is reset.
 */
export async function readPickedPhotoFiles(
  input: HTMLInputElement,
  options?: CompressImageOptions
): Promise<File[]> {
  const originals = Array.from(input.files ?? []).filter(
    (file) => file instanceof File && file.size > 0
  );

  try {
    if (originals.length === 0) return [];
    return await Promise.all(
      originals.map((file) => preparePhotoFileForUpload(file, options))
    );
  } finally {
    input.value = "";
  }
}
