export type PhotoSource = "camera" | "library";

/**
 * Prefer `image/*` first — Safari (iPad/Mac) keys off that for Photos vs Files.
 * Explicit types remain as hints for other browsers / HEIC from iPhone libraries.
 */
const IMAGE_ACCEPT =
  "image/*,image/jpeg,image/png,image/webp,image/heic,image/heif";

export type PhotoFileInputProps = {
  accept: string;
  capture?: "environment" | "user";
};

/** Attributes for a hidden file input that opens camera vs photo library. */
export function photoFileInputProps(source: PhotoSource): PhotoFileInputProps {
  if (source === "camera") {
    // `capture` hints the rear camera on iOS/iPadOS; desktop Safari may fall
    // back to Continuity Camera or a file dialog — library input stays separate.
    return { accept: IMAGE_ACCEPT, capture: "environment" };
  }
  // Omit `capture` entirely so Safari opens the photo library / file picker.
  return { accept: IMAGE_ACCEPT };
}
