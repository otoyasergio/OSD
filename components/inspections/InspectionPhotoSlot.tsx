"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { PhotoCategory } from "@/lib/database/types";
import { FormError } from "@/components/forms/Field";
import { usePhotoUploadQueue } from "@/components/photos/PhotoUploadQueueProvider";
import { CAMERA_ROLL_HINT, photoFileInputProps } from "@/lib/forms/photoSourceInputs";
import { UNREADABLE_PHOTO_MESSAGE } from "@/lib/forms/photoUploadErrors";
import { PhotoQueuePersistenceError } from "@/lib/photos/uploadQueue/errors";
import { photoQueueStatusLabel } from "@/lib/photos/uploadQueue/statusCopy";
import { readPickedPhotoFiles } from "@/lib/forms/readPickedPhotoFiles";

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
  const queue = usePhotoUploadQueue();
  const titleId = useId();
  const cameraInputId = useId();
  const libraryInputId = useId();
  const [chooserOpen, setChooserOpen] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [clientError, setClientError] = useState<string | null>(null);
  const ownedQueueIds = useRef(new Set<string>());
  const refreshedIds = useRef(new Set<string>());
  const cameraProps = photoFileInputProps("camera");
  const libraryProps = photoFileInputProps("library");

  const queued = queue.items.filter((item) => {
    if (item.workOrderId !== workOrderId || item.category !== category) return false;
    if (inspectionResultId) return item.inspectionResultId === inspectionResultId;
    return true;
  });
  const busy = preparing || queued.some((item) => item.status === "uploading");
  const hasPhotos = existingUrls.length > 0 || queued.length > 0;
  const online = queue.isOnline();

  useEffect(() => {
    for (const item of queued) ownedQueueIds.current.add(item.queueId);
  }, [queued]);

  useEffect(() => {
    return queue.subscribeConfirmation((confirmation) => {
      if (!ownedQueueIds.current.has(confirmation.queueId)) return;
      if (refreshedIds.current.has(confirmation.queueId)) return;
      refreshedIds.current.add(confirmation.queueId);
      router.refresh();
    });
  }, [queue, router]);

  useEffect(() => {
    for (const receipt of queue.confirmations) {
      if (receipt.workOrderId !== workOrderId || receipt.category !== category) {
        continue;
      }
      if (inspectionResultId && receipt.inspectionResultId !== inspectionResultId) {
        continue;
      }
      if (!receipt.photoId || refreshedIds.current.has(receipt.queueId)) continue;
      const present = existingUrls.some((url) => url.includes(receipt.photoId));
      if (present) continue;
      refreshedIds.current.add(receipt.queueId);
      router.refresh();
    }
  }, [
    category,
    existingUrls,
    inspectionResultId,
    queue.confirmations,
    router,
    workOrderId,
  ]);

  useEffect(() => {
    if (!chooserOpen) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setChooserOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [chooserOpen]);

  async function enqueueFromInput(input: HTMLInputElement) {
    setChooserOpen(false);
    setClientError(null);
    setPreparing(true);
    try {
      const files = await readPickedPhotoFiles(input);
      if (files.length === 0) return;
      for (const file of files) {
        const queuedItem = await queue.enqueue({
          file,
          category,
          workOrderId,
          inspectionResultId: inspectionResultId ?? undefined,
        });
        ownedQueueIds.current.add(queuedItem.queueId);
      }
    } catch (error) {
      if (error instanceof PhotoQueuePersistenceError) {
        setClientError(error.message);
      } else {
        setClientError(UNREADABLE_PHOTO_MESSAGE);
      }
    } finally {
      setPreparing(false);
    }
  }

  const previews = [
    ...queued.map((item) => ({
      key: item.queueId,
      src: queue.previewUrl(item.queueId),
      pending: item.status !== "failed" && item.status !== "saved",
      failed: item.status === "failed",
      status: photoQueueStatusLabel(item, online),
      queueId: item.queueId,
    })),
    ...existingUrls.map((src, index) => ({
      key: `saved-${src}-${index}`,
      src,
      pending: false,
      failed: false,
      status: "Saved",
      queueId: null as string | null,
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
            onExpand && preview.src && !preview.pending && !preview.failed ? (
              <button
                key={preview.key}
                type="button"
                className="inspection-photo-slot-expand"
                onClick={() => onExpand(preview.src!)}
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
            ) : preview.src ? (
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
            ) : (
              <span key={preview.key} className="inspection-photo-slot-placeholder">
                {preview.status}
              </span>
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
        {queued.map((item) => (
          <p
            key={`${item.queueId}-status`}
            className="inspection-photo-slot-count"
            role="status"
          >
            {photoQueueStatusLabel(item, online)}
            {item.status === "queued" && !online
              ? " — Saved on this device — waiting for connection."
              : ""}
          </p>
        ))}
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
                void enqueueFromInput(event.currentTarget);
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
                void enqueueFromInput(event.currentTarget);
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
                : busy
                  ? "Uploading…"
                  : hasPhotos
                    ? "Add another photo"
                    : "Add photo"}
            </button>
            {queued
              .filter((item) => item.status === "failed")
              .map((item) => (
                <button
                  key={`${item.queueId}-retry`}
                  type="button"
                  className="btn btn-secondary min-h-11 w-full"
                  onClick={() => {
                    void queue.retry(item.queueId);
                  }}
                >
                  Retry
                </button>
              ))}
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
