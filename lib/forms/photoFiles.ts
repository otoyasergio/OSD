/** Usable photo files from a form that may send one or many `file` parts. */
export function collectPhotoFiles(formData: FormData, fieldName = "file"): File[] {
  return formData.getAll(fieldName).filter((value): value is File => {
    if (!(value instanceof File)) return false;
    if (value.size === 0) return false;
    if (!value.name || value.name === "undefined") return false;
    return true;
  });
}
