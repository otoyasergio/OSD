"use client";

import {
  startTransition,
  useActionState,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import type { PhotoCategory } from "@/lib/database/types";
import {
  uploadIntakePhotoAction,
  type PhotoFormState,
} from "@/app/(app)/work_orders/photo-actions";
import { FormError } from "@/components/forms/Field";
import { preparePhotoFileForUpload } from "@/lib/forms/preparePhotoFileForUpload";
import { photoFileInputProps } from "@/lib/forms/photoSourceInputs";

export function InspectionPhotoSlot({
  workOrderId,
  category,
  inspectionResultId,
  label,
  required,
  existingUrls = [],
  readOnly,
  onExpand,
}: {
  workOrderId: string;
  category: PhotoCategory;
  inspectionResultId?: string | null;
  label: string;
  required?: boolean;
  existingUrls?: string[];
  readOnly?: boolean;
  onExpand?: (src: string) => void;
}) {
  const titleId = useId();
  const cameraInputId = useId();
  const libraryInputId = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const [chooserOpen, setChooserOpen] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [clientError, setClientError] = useState<string | null>(null);
  const [state, formAction, pending] = useActionState(
    uploadIntakePhotoAction.bind(null, workOrderId),
    { error: null } satisfies PhotoFormState
  );
  const cameraProps = photoFileInputProps("camera");
  const libraryProps = photoFileInputProps("library");
  const busy = pending || preparing;
  const hasPhotos = existingUrls.length > 0;

  useEffect(() => {
    if (!chooserOpen) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setChooserOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [chooserOpen]);

  async function uploadFromInput(input: HTMLInputElement) {
    const originals = Array.from(input.files ?? []);
    setChooserOpen(false);
    setClientError(null);
    if (originals.length === 0 || !formRef.current) return;

    setPreparing(true);
    try {
      // Clone/compress before clearing the input — iOS library File refs can
      // become invalid as soon as the input value is reset.
      const files = await Promise.all(
        originals.map((original) => preparePhotoFileForUpload(original))
      );
      input.value = "";
      const formData = new FormData(formRef.current);
      formData.delete("file");
      for (const file of files) formData.append("file", file);
      startTransition(() => {
        formAction(formData);
      });
    } catch {
      input.value = "";
      setClientError("Could not read that photo. Try again, or use the camera instead.");
    } finally {
      setPreparing(false);
    }
  }

  return (
    <div
      className={`inspection-photo-slot ${
        required && !hasPhotos ? "inspection-photo-slot--required" : ""
      } ${hasPhotos ? "inspection-photo-slot--done" : ""}`}
    >
      <div className="inspection-photo-slot-preview">
        {hasPhotos ? (
          existingUrls.map((src, index) =>
            onExpand ? (
              <button
                key={`${src}-${index}`}
                type="button"
                className="inspection-photo-slot-expand"
                onClick={() => onExpand(src)}
                aria-label={`View ${label} photo ${index + 1} larger`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- signed storage URLs */}
                <img src={src} alt={`${label} ${index + 1}`} />
              </button>
            ) : (
              // eslint-disable-next-line @next/next/no-img-element -- signed storage URLs
              <img key={`${src}-${index}`} src={src} alt={`${label} ${index + 1}`} />
            )
          )
        ) : (
          <span className="inspection-photo-slot-placeholder">
            {required ? "Photo required" : "Optional photo"}
          </span>
        )}
      </div>
      <div className="inspection-photo-slot-meta">
        <p className="inspection-photo-slot-label">{label}</p>
        {hasPhotos ? (
          <p className="inspection-photo-slot-count">
            {existingUrls.length} photo{existingUrls.length === 1 ? "" : "s"}
          </p>
        ) : null}
        {!readOnly ? (
          <form ref={formRef} action={formAction} className="inspection-photo-slot-form">
            <input type="hidden" name="category" value={category} />
            {inspectionResultId ? (
              <input
                type="hidden"
                name="inspection_result_id"
                value={inspectionResultId}
              />
            ) : null}
            <input
              id={cameraInputId}
              type="file"
              accept={cameraProps.accept}
              capture={cameraProps.capture}
              className="photo-file-input"
              tabIndex={-1}
              aria-label={`${label} camera`}
              onChange={(e) => {
                void uploadFromInput(e.currentTarget);
              }}
            />
            <input
              id={libraryInputId}
              type="file"
              accept={libraryProps.accept}
              multiple
              className="photo-file-input"
              tabIndex={-1}
              aria-label={`${label} photo library`}
              onChange={(e) => {
                void uploadFromInput(e.currentTarget);
              }}
            />
            <button
              type="button"
              disabled={busy}
              className="btn btn-secondary min-h-12 w-full"
              onClick={() => setChooserOpen(true)}
            >
              {busy ? "Uploading…" : hasPhotos ? "Add another photo" : "Add photo"}
            </button>
            <FormError message={state.error ?? clientError} />
          </form>
        ) : null}
      </div>

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
              {hasPhotos ? `Add another ${label}` : `Add ${label}`}
            </p>
            <p className="photo-source-sheet-lede">
              Take as many as you need. Camera takes one at a time; library can pick
              several.
            </p>
            <label
              htmlFor={cameraInputId}
              className="btn btn-primary photo-source-sheet-action"
            >
              Camera
            </label>
            <label
              htmlFor={libraryInputId}
              className="btn btn-secondary photo-source-sheet-action"
            >
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
