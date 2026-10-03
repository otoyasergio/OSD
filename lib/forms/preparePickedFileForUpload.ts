import { compressImageForUpload } from "@/lib/forms/compressImageForUpload";
import type { CompressImageOptions } from "@/lib/forms/compressImageForUpload";
import { sniffAllowedUploadMime, usablePhotoName } from "@/lib/forms/imageMime";
import { PickedFileError, UNREADABLE_PHOTO_MESSAGE } from "@/lib/forms/photoUploadErrors";

function isReadableFile(file: unknown): file is File {
  return (
    typeof file === "object" &&
    file !== null &&
    typeof (file as File).arrayBuffer === "function"
  );
}

/**
 * Clone a picked image or PDF so clearing the `<input type="file">` cannot
 * invalidate the bytes. Images go through orientation/compression when the
 * browser can decode them. PDFs stay PDFs.
 */
export async function preparePickedFileForUpload(
  file: File,
  options?: CompressImageOptions
): Promise<File> {
  if (!isReadableFile(file)) {
    throw new PickedFileError("unreadable");
  }

  let bytes: ArrayBuffer;
  try {
    bytes = await file.arrayBuffer();
  } catch {
    throw new PickedFileError("unreadable");
  }
  if (bytes.byteLength === 0) {
    throw new PickedFileError("empty");
  }

  const type = sniffAllowedUploadMime(bytes);
  if (!type) {
    throw new PickedFileError("invalid_type");
  }

  const cloned = new File([bytes], usablePhotoName(file.name, type), {
    type,
    lastModified: file.lastModified || Date.now(),
  });

  if (type === "application/pdf") {
    return cloned;
  }

  try {
    return await compressImageForUpload(cloned, options);
  } catch {
    throw new PickedFileError("unreadable");
  }
}

export { UNREADABLE_PHOTO_MESSAGE, PickedFileError };
