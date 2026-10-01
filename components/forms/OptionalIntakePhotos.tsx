"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { CameraIcon, LibraryIcon } from "@/components/forms/IntakePhotoSlots";
import { usePhotoUploadQueue } from "@/components/photos/PhotoUploadQueueProvider";
import { UNREADABLE_PHOTO_MESSAGE } from "@/lib/forms/photoUploadErrors";
import { persistQueueErrorMessage } from "@/lib/photos/intakeQueue";
import { PhotoQueuePersistenceError } from "@/lib/photos/uploadQueue/errors";
import { photoQueueStatusLabel } from "@/lib/photos/uploadQueue/statusCopy";
import { CAMERA_ROLL_HINT, photoFileInputProps } from "@/lib/forms/photoSourceInputs";
import { readPickedPhotoFiles } from "@/lib/forms/readPickedPhotoFiles";

type Props = {
  value: File[];
  onChange: (next: File[]) => void;
  disabled?: boolean;
  intakeDraftId?: string;
  workOrderId?: string;
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
  intakeDraftId,
  workOrderId,
}: Props) {
  const queue = usePhotoUploadQueue();
  const titleId = useId();
  const cameraInputId = `${useId()}-optional-camera`;
  const libraryInputId = `${useId()}-optional-library`;
  const valueRef = useRef(value);
  const [chooserOpen, setChooserOpen] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [pickError, setPickError] = useState<string | null>(null);

  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  const previews = useMemo(
    () =>
      value.map((file, index) => {
        const match = queue.items.find(
          (item) =>
            item.category === "other" &&
            item.fileName === file.name &&
            item.byteCount === file.size &&
            item.lastModified === file.lastModified &&
            (workOrderId
              ? item.workOrderId === workOrderId
              : item.intakeDraftId === intakeDraftId)
        );
        const queuedUrl = match ? queue.previewUrl(match.queueId) : null;
        return {
          file,
          index,
          url: queuedUrl,
          ownedUrl: queuedUrl ? null : URL.createObjectURL(file),
          status: match ? photoQueueStatusLabel(match, queue.isOnline()) : null,
        };
      }),
    [intakeDraftId, queue, value, workOrderId]
  );

  useEffect(() => {
    return () => {
      for (const preview of previews) {
        if (preview.ownedUrl) URL.revokeObjectURL(preview.ownedUrl);
      }
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

  async function addFiles(input: HTMLInputElement) {
    setChooserOpen(false);
    setPickError(null);
    setPreparing(true);
    try {
      const prepared = await readPickedPhotoFiles(input);
      const committed: File[] = [];
      for (const file of prepared) {
        await queue.enqueue({
          file,
          category: "other",
          intakeDraftId: workOrderId ? undefined : intakeDraftId,
          workOrderId,
          replaceExisting: false,
        });
        committed.push(file);
      }
      if (committed.length === 0) return;
      const next = mergeOptionalIntakePhotos(valueRef.current, committed);
      valueRef.current = next;
      onChange(next);
    } catch (error) {
      if (error instanceof PhotoQueuePersistenceError) {
        setPickError(error.message);
      } else {
        setPickError(UNREADABLE_PHOTO_MESSAGE);
      }
    } finally {
      setPreparing(false);
    }
  }

  async function removeAt(index: number) {
    const file = value[index];
    if (!file) return;
    const match = queue.items.find(
      (item) =>
        item.category === "other" &&
        item.fileName === file.name &&
        item.byteCount === file.size &&
        item.lastModified === file.lastModified &&
        (workOrderId
          ? item.workOrderId === workOrderId
          : item.intakeDraftId === intakeDraftId)
    );
    if (match) {
      try {
        await queue.remove(match.queueId);
      } catch (error) {
        setPickError(persistQueueErrorMessage(error));
        return;
      }
    }
    const next = value.filter((_, itemIndex) => itemIndex !== index);
    valueRef.current = next;
    onChange(next);
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
          {preparing ? "Preparing…" : `${value.length} added`}
        </span>
      </div>

      {pickError ? (
        <p role="alert" className="intake-photo-pick-error">
          {pickError}
        </p>
      ) : null}

      <div className="optional-intake-photos-grid">
        {previews.map(({ file, index, url, ownedUrl, status }) => (
          <div
            key={`${fileIdentity(file)}:${index}`}
            className="optional-intake-photo-card"
          >
            {url || ownedUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={url ?? ownedUrl ?? ""} alt={`Extra intake photo ${index + 1}`} />
            ) : null}
            <span className="optional-intake-photo-label">Extra {index + 1}</span>
            {status ? (
              <p className="optional-intake-photo-status" role="status">
                {status}
              </p>
            ) : null}
            <button
              type="button"
              className="optional-intake-photo-remove"
              disabled={disabled || preparing}
              aria-label={`Remove extra intake photo ${index + 1}`}
              onClick={() => {
                void removeAt(index);
              }}
            >
              Remove
            </button>
          </div>
        ))}

        <button
          type="button"
          className="optional-intake-photo-add"
          disabled={disabled || preparing}
          onClick={() => setChooserOpen(true)}
        >
          <span className="optional-intake-photo-add-icon">
            <CameraIcon />
          </span>
          <span>Add extra photos</span>
          <span className="optional-intake-photo-add-hint">
            {preparing ? "Preparing photo…" : "Camera or Library"}
          </span>
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
          void addFiles(event.currentTarget);
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
          void addFiles(event.currentTarget);
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
              Take one photo now, or select one or more from your library.{" "}
              {CAMERA_ROLL_HINT}
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
