import { compressImageForUpload } from "@/lib/forms/compressImageForUpload";
import type { CompressImageOptions } from "@/lib/forms/compressImageForUpload";
import { UNREADABLE_PHOTO_MESSAGE } from "@/lib/forms/photoUploadErrors";

export { UNREADABLE_PHOTO_MESSAGE };

/**
 * Prepare a picked photo for a server-action upload.
 *
 * Always returns a File that is independent of the `<input type="file">`.
 * On iOS Safari, photo-library File objects can become unreadable after the
 * input value is cleared — camera captures are often fine, library picks are not.
 * Compression also keeps large library HEIC/JPEG under serverless body limits.
 */
export async function preparePhotoFileForUpload(
  file: File,
  options?: CompressImageOptions
): Promise<File> {
  if (!(file instanceof File) || file.size === 0) return file;

  const compressed = await compressImageForUpload(file, options);
  if (compressed !== file) return compressed;

  return cloneFileForUpload(file);
}

/** Clone a File so clearing the picker cannot invalidate the bytes. */
export async function cloneFileForUpload(file: File): Promise<File> {
  try {
    const bytes = await file.arrayBuffer();
    if (bytes.byteLength === 0) {
      throw new Error(UNREADABLE_PHOTO_MESSAGE);
    }
    return new File([bytes], file.name || "photo.jpg", {
      type: file.type || "image/jpeg",
      lastModified: file.lastModified,
    });
  } catch (error) {
    if (error instanceof Error && error.message === UNREADABLE_PHOTO_MESSAGE) {
      throw error;
    }
    throw new Error(UNREADABLE_PHOTO_MESSAGE);
  }
}
