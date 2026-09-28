export function isCameraPhotoInput(
  input: Pick<HTMLInputElement, "capture"> & {
    hasAttribute?: (name: string) => boolean;
  }
): boolean {
  if (input.capture) return true;
  return typeof input.hasAttribute === "function" && input.hasAttribute("capture");
}

export type SavePhotosToCameraRollDeps = {
  canShare?: (data: ShareData) => boolean;
  share?: (data: ShareData) => Promise<void>;
  download?: (file: File) => void;
};

/** Write a File to the device — iOS share sheet includes Save to Photos. */
export function downloadPhotoFile(file: File): void {
  if (typeof document === "undefined") return;
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = file.name || "photo.jpg";
  link.rel = "noopener";
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/**
 * Best-effort copy of captured photos onto the device.
 *
 * iOS Safari never adds `<input capture>` shots to the Camera Roll. Sharing the
 * File opens the native sheet where "Save to Photos" is available. Other
 * browsers get a download. Must be invoked from a user gesture (file change).
 */
export async function savePhotosToCameraRoll(
  files: File[],
  deps: SavePhotosToCameraRollDeps = {}
): Promise<void> {
  const usable = files.filter(
    (file) => file && typeof file.arrayBuffer === "function" && file.size !== undefined
  );
  if (usable.length === 0) return;

  const data: ShareData = {
    files: usable,
    title: usable.length === 1 ? usable[0].name || "Photo" : "Photos",
  };

  const canShare =
    deps.canShare ??
    ((shareData: ShareData) =>
      typeof navigator !== "undefined" && Boolean(navigator.canShare?.(shareData)));
  const share =
    deps.share ??
    ((shareData: ShareData) => {
      if (typeof navigator === "undefined" || !navigator.share) {
        return Promise.reject(new Error("SHARE_UNAVAILABLE"));
      }
      return navigator.share(shareData);
    });
  const download = deps.download ?? downloadPhotoFile;

  if (canShare(data)) {
    try {
      await share(data);
      return;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;
    }
  }

  for (const file of usable) download(file);
}

/** Fetch a displayed photo (signed URL) and save it to the device. */
export async function saveRemotePhotoToCameraRoll(
  url: string,
  filename: string
): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) throw new Error("PHOTO_DOWNLOAD_FAILED");
  const blob = await response.blob();
  if (blob.size === 0) throw new Error("PHOTO_DOWNLOAD_FAILED");
  const file = new File([blob], filename || "photo.jpg", {
    type: blob.type || "image/jpeg",
  });
  await savePhotosToCameraRoll([file]);
}
