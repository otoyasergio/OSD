import { compressImageForUpload } from "@/lib/forms/compressImageForUpload";

/**
 * Prepare a picked photo for a server-action upload.
 *
 * Always returns a File that is independent of the `<input type="file">`.
 * On iOS Safari, photo-library File objects can become unreadable after the
 * input value is cleared — camera captures are often fine, library picks are not.
 * Compression also keeps large library HEIC/JPEG under serverless body limits.
 */
export async function preparePhotoFileForUpload(file: File): Promise<File> {
  if (!(file instanceof File) || file.size === 0) return file;

  const compressed = await compressImageForUpload(file);
  if (compressed !== file) return compressed;

  const bytes = await file.arrayBuffer();
  return new File([bytes], file.name || "photo.jpg", {
    type: file.type || "image/jpeg",
    lastModified: file.lastModified,
  });
}
