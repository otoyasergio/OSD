import { usablePhotoName } from "@/lib/forms/imageMime";

type NamedBlob = Blob & { name?: string; lastModified?: number };

/** True for File or Blob-like multipart parts that actually contain bytes. */
export function isUploadedPhotoPart(value: FormDataEntryValue): value is File {
  if (typeof value === "string") return false;
  const part = value as NamedBlob;
  if (typeof part.arrayBuffer !== "function") return false;
  if (typeof part.size !== "number" || part.size === 0) return false;
  if (part.name === "undefined") return false;
  return true;
}

function asPhotoFile(value: NamedBlob): File {
  if (value instanceof File) return value;
  return new File([value], usablePhotoName(value.name, value.type), {
    type: value.type || "image/jpeg",
    lastModified: value.lastModified ?? Date.now(),
  });
}

/** Usable photo files from a form that may send one or many `file` parts. */
export function collectPhotoFiles(formData: FormData, fieldName = "file"): File[] {
  return formData.getAll(fieldName).flatMap((value) => {
    if (!isUploadedPhotoPart(value)) return [];
    return [asPhotoFile(value)];
  });
}
