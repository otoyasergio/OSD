"use client";

import { useEffect, useId, useMemo, useState } from "react";
import {
  CameraIcon,
  LibraryIcon,
} from "@/components/forms/IntakePhotoSlots";
import { photoFileInputProps } from "@/lib/forms/photoSourceInputs";

type Props = {
  value: File[];
  onChange: (next: File[]) => void;
  disabled?: boolean;
};

function fileIdentity(file: File): string {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

/** Add usable files while avoiding accidental duplicates from the photo picker. */
export function mergeOptionalIntakePhotos(
  current: File[],
  incoming: Iterable<File>
): File[] {
  const next = [...current];
  const seen = new Set(current.map(fileIdentity));

  for (const file of incoming) {
    if (!(file instanceof File) || file.size === 0) continue;
    const identity = fileIdentity(file);
    if (seen.has(identity)) continue;
    seen.add(identity);
    next.push(file);
  }

  return next;
}

export function OptionalIntakePhotos({
  value,
  onChange,
  disabled = false,
}: Props) {
  const titleId = useId();
  const cameraInputId = `${useId()}-optional-camera`;
  const libraryInputId = `${useId()}-optional-library`;
  const [chooserOpen, setChooserOpen] = useState(false);

  const previews = useMemo(
    () =>
      value.map((file, index) => ({
        file,
        index,
        url: URL.createObjectURL(file),
      })),
    [value]
  );

  useEffect(() => {
    return () => {
      for (const preview of previews) URL.revokeObjectURL(preview.url);
    };
  }, [previews]);

  useEffect(() => {
    if (!chooserOpen) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setChooserOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [chooserOpen]);

  const cameraProps = photoFileInputProps("camera");
  const libraryProps = photoFileInputProps("library");

  function addFiles(files: FileList | null) {
    if (!files) return;
    onChange(mergeOptionalIntakePhotos(value, Array.from(files)));
    setChooserOpen(false);
  }

  return (
    <div className="optional-intake-photos">
      <div className="optional-intake-photos-header">
        <div>
          <h3 className="optional-intake-photos-title">Extra photos</h3>
          <p className="optional-intake-photos-lede">
            Optional — add damage, accessories, or anything else worth recording.
          </p>
        </div>
        <span className="optional-intake-photos-count" role="status" aria-live="polite">
          {value.length} added
        </span>
      </div>

      <div className="optional-intake-photos-grid">
        {previews.map(({ file, index, url }) => (
          <div
            key={`${fileIdentity(file)}:${index}`}
            className="optional-intake-photo-card"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={url} alt={`Extra intake photo ${index + 1}`} />
            <span className="optional-intake-photo-label">Extra {index + 1}</span>
            <button
              type="button"
              className="optional-intake-photo-remove"
              disabled={disabled}
              aria-label={`Remove extra intake photo ${index + 1}`}
              onClick={() => onChange(value.filter((_, itemIndex) => itemIndex !== index))}
            >
              Remove
            </button>
          </div>
        ))}

        <button
          type="button"
          className="optional-intake-photo-add"
          disabled={disabled}
          onClick={() => setChooserOpen(true)}
        >
          <span className="optional-intake-photo-add-icon">
            <CameraIcon />
          </span>
          <span>Add extra photos</span>
          <span className="optional-intake-photo-add-hint">Camera or Library</span>
        </button>
      </div>

      <input
        id={cameraInputId}
        className="photo-file-input"
        type="file"
        accept={cameraProps.accept}
        capture={cameraProps.capture}
        tabIndex={-1}
        disabled={disabled}
        aria-label="Extra photo camera"
        onChange={(event) => {
          addFiles(event.target.files);
          event.target.value = "";
        }}
      />
      <input
        id={libraryInputId}
        className="photo-file-input"
        type="file"
        accept={libraryProps.accept}
        multiple
        tabIndex={-1}
        disabled={disabled}
        aria-label="Extra photos library"
        onChange={(event) => {
          addFiles(event.target.files);
          event.target.value = "";
        }}
      />

      {chooserOpen ? (
        <div
          className="photo-source-sheet"
          role="presentation"
          onClick={() => setChooserOpen(false)}
        >
          <div
            className="photo-source-sheet-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            onClick={(event) => event.stopPropagation()}
          >
            <p id={titleId} className="photo-source-sheet-title">
              Add extra photos
            </p>
            <p className="photo-source-sheet-lede">
              Take one photo now, or select one or more from your library.
            </p>
            <label
              htmlFor={cameraInputId}
              className="btn btn-primary photo-source-sheet-action"
            >
              <CameraIcon />
              Camera
            </label>
            <label
              htmlFor={libraryInputId}
              className="btn btn-secondary photo-source-sheet-action"
            >
              <LibraryIcon />
              Library
            </label>
            <button
              type="button"
              className="btn btn-ghost photo-source-sheet-cancel"
              onClick={() => setChooserOpen(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
