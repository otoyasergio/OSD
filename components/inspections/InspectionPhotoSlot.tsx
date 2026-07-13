"use client";

import { useActionState, useEffect, useId, useRef, useState } from "react";
import type { PhotoCategory } from "@/lib/database/types";
import {
  uploadIntakePhotoAction,
  type PhotoFormState,
} from "@/app/(app)/work_orders/photo-actions";
import { FormError } from "@/components/forms/Field";
import { photoFileInputProps } from "@/lib/forms/photoSourceInputs";

export function InspectionPhotoSlot({
  workOrderId,
  category,
  inspectionResultId,
  label,
  required,
  existingUrl,
  readOnly,
}: {
  workOrderId: string;
  category: PhotoCategory;
  inspectionResultId?: string | null;
  label: string;
  required?: boolean;
  existingUrl?: string | null;
  readOnly?: boolean;
}) {
  const titleId = useId();
  const cameraInputId = useId();
  const libraryInputId = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const [chooserOpen, setChooserOpen] = useState(false);
  const [state, formAction, pending] = useActionState(
    uploadIntakePhotoAction.bind(null, workOrderId),
    { error: null } satisfies PhotoFormState
  );
  const cameraProps = photoFileInputProps("camera");
  const libraryProps = photoFileInputProps("library");

  useEffect(() => {
    if (!chooserOpen) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setChooserOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [chooserOpen]);

  function uploadFromInput(input: HTMLInputElement) {
    const file = input.files?.[0];
    setChooserOpen(false);
    if (!file || !formRef.current) return;
    const formData = new FormData(formRef.current);
    formData.set("file", file);
    formAction(formData);
    input.value = "";
  }

  return (
    <div
      className={`inspection-photo-slot ${
        required && !existingUrl ? "inspection-photo-slot--required" : ""
      } ${existingUrl ? "inspection-photo-slot--done" : ""}`}
    >
      <div className="inspection-photo-slot-preview">
        {existingUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={existingUrl} alt={label} />
        ) : (
          <span className="inspection-photo-slot-placeholder">
            {required ? "Photo required" : "Optional photo"}
          </span>
        )}
      </div>
      <div className="inspection-photo-slot-meta">
        <p className="inspection-photo-slot-label">{label}</p>
        {!readOnly ? (
          <form
            ref={formRef}
            action={formAction}
            className="inspection-photo-slot-form"
          >
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
              onChange={(e) => uploadFromInput(e.currentTarget)}
            />
            <input
              id={libraryInputId}
              type="file"
              accept={libraryProps.accept}
              className="photo-file-input"
              tabIndex={-1}
              aria-label={`${label} photo library`}
              onChange={(e) => uploadFromInput(e.currentTarget)}
            />
            <button
              type="button"
              disabled={pending}
              className="btn btn-secondary min-h-12 w-full"
              onClick={() => setChooserOpen(true)}
            >
              {pending
                ? "Uploading…"
                : existingUrl
                  ? "Replace photo"
                  : "Add photo"}
            </button>
            <FormError message={state.error} />
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
              {existingUrl ? `Replace ${label}` : `Add ${label}`}
            </p>
            <p className="photo-source-sheet-lede">
              Use the camera, or choose an existing photo from your library.
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
