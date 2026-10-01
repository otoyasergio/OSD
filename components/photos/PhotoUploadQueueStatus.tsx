"use client";

import { useState } from "react";
import { PHOTO_CATEGORY_LABELS } from "@/lib/status/labels";
import type { PhotoCategory } from "@/lib/database/types";
import { useOptionalPhotoUploadQueue } from "@/components/photos/PhotoUploadQueueProvider";
import {
  PHOTO_QUEUE_OFFLINE_SAVED,
  photoQueueIndicatorLabel,
  photoQueueItemContext,
  photoQueueStatusDetail,
  photoQueueStatusLabel,
} from "@/lib/photos/uploadQueue/statusCopy";

export function PhotoUploadQueueStatus() {
  const queue = useOptionalPhotoUploadQueue();
  const [open, setOpen] = useState(false);
  if (!queue || queue.items.length === 0) return null;

  const indicator = photoQueueIndicatorLabel(queue.items);
  if (!indicator) return null;
  const online = queue.isOnline();
  const offlineWaiting = !online && queue.items.some((item) => item.status === "queued");

  return (
    <div className="photo-queue-status">
      <button
        type="button"
        className="photo-queue-status-toggle"
        aria-expanded={open}
        aria-controls="photo-queue-status-panel"
        aria-haspopup="true"
        onClick={() => setOpen((current) => !current)}
      >
        <span role="status" aria-live="polite">
          {indicator}
          {offlineWaiting ? ` — ${PHOTO_QUEUE_OFFLINE_SAVED}` : ""}
        </span>
      </button>
      {open ? (
        <div
          id="photo-queue-status-panel"
          className="photo-queue-status-panel"
          role="region"
          aria-label="Photo upload queue"
        >
          <ul className="photo-queue-status-list">
            {queue.items.map((item) => {
              const categoryLabel =
                PHOTO_CATEGORY_LABELS[item.category as PhotoCategory] ?? item.category;
              const canRemove = item.status !== "uploading";
              const canRetry = item.status === "failed" || item.status === "queued";
              return (
                <li key={item.queueId} className="photo-queue-status-item">
                  <p className="photo-queue-status-item-title">{categoryLabel}</p>
                  <p className="photo-queue-status-item-meta">
                    {photoQueueItemContext(item)} · {photoQueueStatusLabel(item, online)}
                  </p>
                  <p className="photo-queue-status-item-detail" role="status">
                    {photoQueueStatusDetail(item, online)}
                  </p>
                  <div className="photo-queue-status-item-actions">
                    {canRetry ? (
                      <button
                        type="button"
                        className="btn btn-secondary"
                        aria-label={`Retry ${categoryLabel} photo`}
                        onClick={() => {
                          if (item.status === "failed") void queue.retry(item.queueId);
                        }}
                      >
                        Retry
                      </button>
                    ) : null}
                    {canRemove ? (
                      <button
                        type="button"
                        className="btn btn-ghost"
                        aria-label={`Remove ${categoryLabel} photo`}
                        onClick={() => {
                          void queue.remove(item.queueId);
                        }}
                      >
                        Remove
                      </button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
