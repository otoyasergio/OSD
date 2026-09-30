"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { PhotoCategory } from "@/lib/database/types";
import {
  uploadIntakePhotoAction,
  type PhotoFormState,
} from "@/app/(app)/work_orders/photo-actions";
import { FormError } from "@/components/forms/Field";
import { CAMERA_ROLL_HINT, photoFileInputProps } from "@/lib/forms/photoSourceInputs";
import {
  UNREADABLE_PHOTO_MESSAGE,
  describePhotoUploadFailure,
  photoTooLargeMessage,
} from "@/lib/forms/photoUploadErrors";
import { readPickedPhotoFiles } from "@/lib/forms/readPickedPhotoFiles";
import { withPhotoUploadRetries } from "@/lib/forms/retryPhotoUpload";
import { exceedsServerActionUploadLimit } from "@/lib/forms/uploadLimits";

type LocalShot = {
  id: string;
  url: string;
  status: "saving" | "failed";
};

const IDLE: PhotoFormState = { error: null };

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
  const router = useRouter();
  const titleId = useId();
  const cameraInputId = useId();
  const libraryInputId = useId();
  const [chooserOpen, setChooserOpen] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [clientError, setClientError] = useState<string | null>(null);
  const [localShots, setLocalShots] = useState<LocalShot[]>([]);
  const knownUrls = useRef<Set<string> | null>(null);
  const localShotsRef = useRef<LocalShot[]>([]);
  const cameraProps = photoFileInputProps("camera");
  const libraryProps = photoFileInputProps("library");
  const busy = preparing || uploading;
  const hasPhotos = existingUrls.length > 0 || localShots.length > 0;

  useEffect(() => {
    localShotsRef.current = localShots;
  }, [localShots]);

  useEffect(() => {
    return () => {
      for (const shot of localShotsRef.current) URL.revokeObjectURL(shot.url);
    };
  }, []);

  useEffect(() => {
    if (knownUrls.current === null) {
      knownUrls.current = new Set(existingUrls);
      return;
    }
    const fresh = existingUrls.filter((url) => !knownUrls.current?.has(url));
    knownUrls.current = new Set(existingUrls);
    if (fresh.length === 0) return;
    setLocalShots((current) => {
      let remaining = fresh.length;
      const next: LocalShot[] = [];
      for (const shot of current) {
        if (shot.status === "saving" && remaining > 0) {
          remaining -= 1;
          URL.revokeObjectURL(shot.url);
          continue;
        }
        next.push(shot);
      }
      return next;
    });
  }, [existingUrls]);

  useEffect(() => {
    if (!chooserOpen) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setChooserOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [chooserOpen]);

  async function uploadFromInput(input: HTMLInputElement) {
    setChooserOpen(false);
    setClientError(null);
    setPreparing(true);
    try {
      const files = await readPickedPhotoFiles(input);
      if (files.length === 0) return;

      const shots: LocalShot[] = files.map((file) => ({
        id: crypto.randomUUID(),
        url: URL.createObjectURL(file),
        status: "saving",
      }));
      setLocalShots((current) => [
        ...current.filter((shot) => shot.status !== "failed"),
        ...shots,
      ]);
      setPreparing(false);
      setUploading(true);

      let failed = 0;
      let saved = 0;
      for (let index = 0; index < files.length; index += 1) {
        const file = files[index];
        const shot = shots[index];
        if (!file || !shot) continue;
        let result: PhotoFormState;
        if (exceedsServerActionUploadLimit(file)) {
          // Vercel would refuse this request before the app runs; say so here
          // instead of letting the crash reach the error boundary.
          result = { error: photoTooLargeMessage(file) };
        } else {
          try {
            result = await withPhotoUploadRetries(
              async () => {
                try {
                  const formData = new FormData();
                  formData.set("category", category);
                  if (inspectionResultId) {
                    formData.set("inspection_result_id", inspectionResultId);
                  }
                  formData.set("file", file);
                  return await uploadIntakePhotoAction(workOrderId, IDLE, formData);
                } catch (error) {
                  return { error: describePhotoUploadFailure(error) };
                }
              },
              {
                isSuccess: (value) => !value.error,
                getFailureMessage: (value) => value.error,
              }
            );
          } catch (error) {
            result = { error: describePhotoUploadFailure(error) };
          }
        }
        if (result.error) {
          failed += 1;
          setClientError(result.error);
          setLocalShots((current) =>
            current.map((item) =>
              item.id === shot.id ? { ...item, status: "failed" } : item
            )
          );
        } else {
          saved += 1;
        }
      }
      if (saved > 0) router.refresh();
      if (failed > 1) {
        setClientError(
          `${failed} photos could not be saved. The ones that succeeded are on this inspection and in Ask OTOMOTO.`
        );
      }
    } catch {
      setClientError(UNREADABLE_PHOTO_MESSAGE);
    } finally {
      setPreparing(false);
      setUploading(false);
    }
  }

  const previews = [
    ...localShots.map((shot) => ({
      key: shot.id,
      src: shot.url,
      pending: shot.status === "saving",
      failed: shot.status === "failed",
    })),
    ...existingUrls.map((src, index) => ({
      key: `saved-${src}-${index}`,
      src,
      pending: false,
      failed: false,
    })),
  ];

  return (
    <div
      className={`inspection-photo-slot ${
        required && !hasPhotos ? "inspection-photo-slot--required" : ""
      } ${hasPhotos ? "inspection-photo-slot--done" : ""}`}
    >
      <div className="inspection-photo-slot-preview">
        {hasPhotos ? (
          previews.map((preview, index) =>
            onExpand && !preview.pending && !preview.failed ? (
              <button
                key={preview.key}
                type="button"
                className="inspection-photo-slot-expand"
                onClick={() => onExpand(preview.src)}
                aria-label={`View ${label} photo ${index + 1} larger`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- signed storage URLs */}
                <img
                  src={preview.src}
                  alt={`${label} ${index + 1}`}
                  decoding="async"
                  loading={preview.pending ? "eager" : "lazy"}
                />
              </button>
            ) : (
              // eslint-disable-next-line @next/next/no-img-element -- signed or local preview
              <img
                key={preview.key}
                src={preview.src}
                alt={
                  preview.failed
                    ? `${label} ${index + 1} failed to save`
                    : `${label} ${index + 1}`
                }
                decoding="async"
                loading={preview.pending ? "eager" : "lazy"}
              />
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
            {previews.length} photo{previews.length === 1 ? "" : "s"}
          </p>
        ) : null}
        {uploading ? (
          <p className="inspection-photo-slot-count" role="status">
            Saving to this inspection and Ask OTOMOTO…
          </p>
        ) : null}
        {!readOnly ? (
          <form
            className="inspection-photo-slot-form"
            onSubmit={(event) => event.preventDefault()}
          >
            <input
              id={cameraInputId}
              type="file"
              accept={cameraProps.accept}
              capture={cameraProps.capture}
              className="photo-file-input"
              tabIndex={-1}
              aria-label={`${label} camera`}
              onChange={(event) => {
                void uploadFromInput(event.currentTarget);
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
              onChange={(event) => {
                void uploadFromInput(event.currentTarget);
              }}
            />
            <button
              type="button"
              disabled={busy}
              className="btn btn-secondary min-h-12 w-full"
              onClick={() => setChooserOpen(true)}
            >
              {preparing
                ? "Preparing photo…"
                : uploading
                  ? "Uploading…"
                  : hasPhotos
                    ? "Add another photo"
                    : "Add photo"}
            </button>
            <FormError message={clientError} />
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
              Take as many as you need. Each photo is saved on this inspection and kept
              for Ask OTOMOTO. Camera takes one at a time; library can pick several.{" "}
              {CAMERA_ROLL_HINT}
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
