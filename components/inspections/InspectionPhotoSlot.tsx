"use client";

import { useActionState, useRef } from "react";
import type { PhotoCategory } from "@/lib/database/types";
import {
  uploadIntakePhotoAction,
  type PhotoFormState,
} from "@/app/(app)/work_orders/photo-actions";
import { FormError } from "@/components/forms/Field";

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
  const inputRef = useRef<HTMLInputElement>(null);
  const [state, formAction, pending] = useActionState(
    uploadIntakePhotoAction.bind(null, workOrderId),
    { error: null } satisfies PhotoFormState
  );

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
          <form action={formAction} className="inspection-photo-slot-form">
            <input type="hidden" name="category" value={category} />
            {inspectionResultId ? (
              <input
                type="hidden"
                name="inspection_result_id"
                value={inspectionResultId}
              />
            ) : null}
            <input
              ref={inputRef}
              type="file"
              name="file"
              accept="image/*"
              capture="environment"
              className="sr-only"
              required
              onChange={(e) => {
                if (e.currentTarget.files?.length) {
                  e.currentTarget.form?.requestSubmit();
                }
              }}
            />
            <button
              type="button"
              disabled={pending}
              className="btn btn-secondary min-h-12 w-full"
              onClick={() => inputRef.current?.click()}
            >
              {pending
                ? "Uploading…"
                : existingUrl
                  ? "Replace photo"
                  : "Take / upload photo"}
            </button>
            <FormError message={state.error} />
          </form>
        ) : null}
      </div>
    </div>
  );
}
