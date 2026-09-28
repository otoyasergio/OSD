"use client";

import { forwardRef, useId, useImperativeHandle, useRef, useState } from "react";
import { mergeOptionalIntakePhotos } from "@/components/forms/OptionalIntakePhotos";
import { CAMERA_ROLL_HINT, photoFileInputProps } from "@/lib/forms/photoSourceInputs";
import { readPickedPhotoFiles } from "@/lib/forms/readPickedPhotoFiles";

export type FloorPhotoFieldHandle = {
  openCamera: () => void;
  openLibrary: () => void;
};

function readyLabel(files: File[]): string | null {
  if (files.length === 0) return null;
  if (files.length === 1) return `Photo ready — ${files[0].name}`;
  return `${files.length} photos ready`;
}

export const FloorPhotoField = forwardRef<
  FloorPhotoFieldHandle,
  {
    hint: string;
    variant?: "default" | "dock";
    onPhotoReady?: (label: string | null) => void;
  }
>(function FloorPhotoField({ hint, variant = "default", onPhotoReady }, ref) {
  const cameraInputId = useId();
  const libraryInputId = useId();
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

  function notifyPhotoReady(files: File[]) {
    const label = readyLabel(files);
    setPhotoLabel(label);
    onPhotoReady?.(label);
  }

  async function applyPickedFiles(input: HTMLInputElement) {
    const target = fileInputRef.current;
    if (!target) {
      input.value = "";
      return;
    }
    const current = Array.from(target.files ?? []);
    try {
      const prepared = await readPickedPhotoFiles(input);
      if (prepared.length === 0 && current.length === 0) {
        target.value = "";
        notifyPhotoReady([]);
        return;
      }
      const merged = mergeOptionalIntakePhotos(current, prepared);
      const transfer = new DataTransfer();
      for (const file of merged) transfer.items.add(file);
      target.files = transfer.files;
      notifyPhotoReady(merged);
    } catch {
      notifyPhotoReady(current);
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
        multiple
        className="photo-file-input"
        tabIndex={-1}
        aria-label="Selected photos"
        onChange={(event) => {
          notifyPhotoReady(Array.from(event.currentTarget.files ?? []));
        }}
      />
      <input
        id={cameraInputId}
        ref={cameraInputRef}
        type="file"
        accept={cameraProps.accept}
        capture={cameraProps.capture}
        className="photo-file-input"
        tabIndex={-1}
        aria-label="Add photo"
        onChange={(event) => void applyPickedFiles(event.currentTarget)}
      />
      <input
        id={libraryInputId}
        ref={libraryInputRef}
        type="file"
        accept={libraryProps.accept}
        multiple
        className="photo-file-input"
        tabIndex={-1}
        aria-label="Choose from library"
        onChange={(event) => void applyPickedFiles(event.currentTarget)}
      />
      {dock ? null : (
        <>
          <div className="pit-photo-actions">
            {/*
              Native <label htmlFor> is more reliable than input.click()
              on Safari iPad/Mac (user-gesture + no clipped programmatic target).
            */}
            <label htmlFor={cameraInputId} className="pit-photo-add">
              Camera
            </label>
            <label htmlFor={libraryInputId} className="pit-photo-library">
              Library
            </label>
          </div>
          {photoLabel ? (
            <p className="pit-photo-ready" role="status">
              {photoLabel}
            </p>
          ) : (
            <p className="pit-photo-hint">
              {hint}. {CAMERA_ROLL_HINT}
            </p>
          )}
        </>
      )}
    </div>
  );
});
