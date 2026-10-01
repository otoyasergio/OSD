import { compressImageForUpload } from "@/lib/forms/compressImageForUpload";
import type { CompressImageOptions } from "@/lib/forms/compressImageForUpload";
import { sniffImageMime, usablePhotoName } from "@/lib/forms/imageMime";
import { PickedFileError, UNREADABLE_PHOTO_MESSAGE } from "@/lib/forms/photoUploadErrors";

export { UNREADABLE_PHOTO_MESSAGE };

function isReadablePhoto(file: unknown): file is File {
  return (
    typeof file === "object" &&
    file !== null &&
    typeof (file as File).arrayBuffer === "function"
  );
}

/**
 * Prepare a picked photo for a server-action upload.
 *
 * Always returns a File that is independent of the `<input type="file">`.
 * On iOS Safari, photo-library File objects can become unreadable after the
 * input value is cleared — camera captures are often fine, library picks are not.
 * Library files also commonly report `size === 0` and an empty `type` until read.
 * Compression keeps large library HEIC/JPEG under serverless body limits.
 */
export async function preparePhotoFileForUpload(
  file: File,
  options?: CompressImageOptions
): Promise<File> {
  if (!isReadablePhoto(file)) {
    throw new PickedFileError("unreadable");
  }

  const cloned = await cloneFileForUpload(file);
  // The durable queue must persist the pick immediately. Compression waits
  // for a worker script and canvas decode; both stall or fail when offline.
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return cloned;
  }
  return compressImageForUpload(cloned, options);
}

/** Clone a File so clearing the picker cannot invalidate the bytes. */
export async function cloneFileForUpload(file: File): Promise<File> {
  try {
    const bytes = await file.arrayBuffer();
    if (bytes.byteLength === 0) {
      throw new PickedFileError("empty");
    }
    const type = sniffImageMime(bytes) || file.type || "image/jpeg";
    return new File([bytes], usablePhotoName(file.name, type), {
      type,
      lastModified: file.lastModified || Date.now(),
    });
  } catch (error) {
    if (error instanceof PickedFileError) throw error;
    throw new PickedFileError("unreadable");
  }
}
