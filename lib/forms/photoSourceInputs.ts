export type PhotoSource = "camera" | "library";

const IMAGE_ACCEPT =
  "image/jpeg,image/png,image/webp,image/heic,image/heif,image/*";

export type PhotoFileInputProps = {
  accept: string;
  capture?: "environment" | "user";
};

/** Attributes for a hidden file input that opens camera vs photo library. */
export function photoFileInputProps(source: PhotoSource): PhotoFileInputProps {
  if (source === "camera") {
    return { accept: IMAGE_ACCEPT, capture: "environment" };
  }
  return { accept: IMAGE_ACCEPT };
}
