"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { usePhotoUploadQueue } from "@/components/photos/PhotoUploadQueueProvider";
import { CAMERA_ROLL_HINT, photoFileInputProps } from "@/lib/forms/photoSourceInputs";
import {
  UNREADABLE_PHOTO_MESSAGE,
  photoTooLargeMessage,
} from "@/lib/forms/photoUploadErrors";
import { PhotoQueuePersistenceError } from "@/lib/photos/uploadQueue/errors";
import { photoQueueStatusLabel } from "@/lib/photos/uploadQueue/statusCopy";
import { readPickedPhotoFiles } from "@/lib/forms/readPickedPhotoFiles";
import { exceedsServerActionUploadLimit } from "@/lib/forms/uploadLimits";

function readyLabel(count: number): string | null {
  if (count === 0) return null;
  if (count === 1) return "Photo queued";
  return `${count} photos queued`;
}

export function FloorPhotoField({
  hint,
  variant = "default",
  workOrderId,
  jobId,
  category,
  onPhotoReady,
}: {
  hint: string;
  variant?: "default" | "dock";
  workOrderId: string;
  jobId: string;
  category: "job_proof" | "job_work";
  onPhotoReady?: (label: string | null) => void;
}) {
  const router = useRouter();
  const queue = usePhotoUploadQueue();
  const cameraInputId = useId();
  const libraryInputId = useId();
  const refreshedIds = useRef(new Set<string>());
  const [photoLabel, setPhotoLabel] = useState<string | null>(null);
  const [pickError, setPickError] = useState<string | null>(null);
  const cameraProps = photoFileInputProps("camera");
  const libraryProps = photoFileInputProps("library");
  const dock = variant === "dock";
  const online = queue.isOnline();

  const queued = queue.items.filter(
    (item) =>
      item.workOrderId === workOrderId &&
      item.jobId === jobId &&
      item.category === category
  );
  const receipts = queue.confirmations.filter(
    (receipt) =>
      receipt.workOrderId === workOrderId &&
      receipt.jobId === jobId &&
      receipt.category === category
  );

  useEffect(() => {
    return queue.subscribeConfirmation((confirmation) => {
      if (refreshedIds.current.has(confirmation.queueId)) return;
      const receipt = queue.confirmations.find(
        (candidate) => candidate.queueId === confirmation.queueId
      );
      const matches =
        receipt?.workOrderId === workOrderId &&
        receipt?.jobId === jobId &&
        receipt?.category === category;
      if (!matches) return;
      refreshedIds.current.add(confirmation.queueId);
      router.refresh();
    });
  }, [category, jobId, queue, router, workOrderId]);

  useEffect(() => {
    for (const receipt of receipts) {
      if (refreshedIds.current.has(receipt.queueId)) continue;
      refreshedIds.current.add(receipt.queueId);
      router.refresh();
      break;
    }
  }, [receipts, router]);

  function notifyPhotoReady(count: number) {
    const label = readyLabel(count);
    setPhotoLabel(label);
    onPhotoReady?.(label);
  }

  async function applyPickedFiles(input: HTMLInputElement) {
    setPickError(null);
    try {
      const prepared = await readPickedPhotoFiles(input, { surface: "floor" });
      if (prepared.length === 0) {
        notifyPhotoReady(queued.length);
        return;
      }
      let added = 0;
      for (const file of prepared) {
        if (exceedsServerActionUploadLimit(file)) {
          setPickError(photoTooLargeMessage(file));
          continue;
        }
        await queue.enqueue({
          file,
          category,
          workOrderId,
          jobId,
          surface: "floor",
        });
        added += 1;
      }
      notifyPhotoReady(queued.length + added);
    } catch (error) {
      if (error instanceof PhotoQueuePersistenceError) {
        setPickError(error.message);
      } else {
        setPickError(UNREADABLE_PHOTO_MESSAGE);
      }
      notifyPhotoReady(queued.length);
    }
  }

  return (
    <div
      className={["pit-photo-field", dock ? "pit-photo-field--dock" : ""]
        .filter(Boolean)
        .join(" ")}
    >
      <input
        id={cameraInputId}
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
              Native label htmlFor activation is more reliable than a
              programmatic input open on Safari iPad/Mac.
            */}
            <label htmlFor={cameraInputId} className="pit-photo-add">
              Camera
            </label>
            <label htmlFor={libraryInputId} className="pit-photo-library">
              Library
            </label>
          </div>
          {pickError ? (
            <p className="pit-photo-error" role="alert">
              {pickError}
            </p>
          ) : photoLabel ? (
            <p className="pit-photo-ready" role="status">
              {photoLabel}
            </p>
          ) : (
            <p className="pit-photo-hint">
              {hint}. {CAMERA_ROLL_HINT}
            </p>
          )}
          {queued.map((item) => (
            <p key={item.queueId} className="pit-photo-hint" role="status">
              {photoQueueStatusLabel(item, online)}
            </p>
          ))}
          {receipts.map((receipt) => (
            <p key={receipt.queueId} className="pit-photo-hint" role="status">
              Saved
            </p>
          ))}
        </>
      )}
    </div>
  );
}
