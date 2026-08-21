"use client";

import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import { photoFileInputProps } from "@/lib/forms/photoSourceInputs";
import { preparePhotoFileForUpload } from "@/lib/forms/preparePhotoFileForUpload";

export type FloorPhotoFieldHandle = {
  openCamera: () => void;
  openLibrary: () => void;
};

export const FloorPhotoField = forwardRef<
  FloorPhotoFieldHandle,
  {
    hint: string;
    variant?: "default" | "dock";
    onPhotoReady?: (label: string | null) => void;
  }
>(function FloorPhotoField({ hint, variant = "default", onPhotoReady }, ref) {
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const libraryInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [photoLabel, setPhotoLabel] = useState<string | null>(null);
  const cameraProps = photoFileInputProps("camera");
  const libraryProps = photoFileInputProps("library");

  useImperativeHandle(ref, () => ({
    openCamera: () => cameraInputRef.current?.click(),
    openLibrary: () => libraryInputRef.current?.click(),
  }));

  function notifyPhotoReady(label: string | null) {
    setPhotoLabel(label);
    onPhotoReady?.(label);
  }

  async function applyPickedFile(input: HTMLInputElement) {
    const original = input.files?.[0] ?? null;
    const target = fileInputRef.current;
    if (!target) return;
    if (!original) {
      target.value = "";
      notifyPhotoReady(null);
      return;
    }
    try {
      const file = await preparePhotoFileForUpload(original);
      const transfer = new DataTransfer();
      transfer.items.add(file);
      target.files = transfer.files;
      notifyPhotoReady(file.name);
    } catch {
      notifyPhotoReady(null);
    } finally {
      input.value = "";
    }
  }

  const dock = variant === "dock";

  return (
    <div
      className={["pit-photo-field", dock ? "pit-photo-field--dock" : ""]
        .filter(Boolean)
        .join(" ")}
    >
      <input
        ref={fileInputRef}
        type="file"
        name="file"
        accept={libraryProps.accept}
        className="photo-file-input"
        tabIndex={-1}
        aria-label="Selected photo"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          notifyPhotoReady(file?.name ?? null);
        }}
      />
      <input
        ref={cameraInputRef}
        type="file"
        accept={cameraProps.accept}
        capture={cameraProps.capture}
        className="photo-file-input"
        tabIndex={-1}
        aria-label="Add photo"
        onChange={(event) => void applyPickedFile(event.currentTarget)}
      />
      <input
        ref={libraryInputRef}
        type="file"
        accept={libraryProps.accept}
        className="photo-file-input"
        tabIndex={-1}
        aria-label="Choose from library"
        onChange={(event) => void applyPickedFile(event.currentTarget)}
      />
      {dock ? null : (
        <>
          <div className="pit-photo-actions">
            <button
              type="button"
              className="pit-photo-add"
              onClick={() => cameraInputRef.current?.click()}
            >
              Camera
            </button>
            <button
              type="button"
              className="pit-photo-library"
              onClick={() => libraryInputRef.current?.click()}
            >
              Library
            </button>
          </div>
          {photoLabel ? (
            <p className="pit-photo-ready" role="status">
              Photo ready — {photoLabel}
            </p>
          ) : (
            <p className="pit-photo-hint">{hint}</p>
          )}
        </>
      )}
    </div>
  );
});
