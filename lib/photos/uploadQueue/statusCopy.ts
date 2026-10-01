import type { QueuedPhotoUpload } from "./types";
import { photoUploadQueueCounts } from "./prepareQueuedPhoto";

export const PHOTO_QUEUE_OFFLINE_SAVED = "Saved on this device — waiting for connection.";
export const PHOTO_QUEUE_SIGNOUT_WARNING =
  "Photos are still waiting to upload. Uploads will resume only when the same user signs in on this device. Sign out anyway?";

export function photoQueueStatusLabel(item: QueuedPhotoUpload, online: boolean): string {
  if (item.status === "preparing") return "Preparing";
  if (item.status === "uploading") return "Uploading";
  if (item.status === "saved") return "Saved";
  if (item.status === "failed") return "Failed";
  if (!online) return "Waiting for connection";
  return "Waiting to upload";
}

export function photoQueueStatusDetail(item: QueuedPhotoUpload, online: boolean): string {
  if (item.status === "queued" && !online) return PHOTO_QUEUE_OFFLINE_SAVED;
  if (item.lastError) return item.lastError;
  return photoQueueStatusLabel(item, online);
}

export function photoQueueIndicatorLabel(items: QueuedPhotoUpload[]): string | null {
  const counts = photoUploadQueueCounts(items);
  if (counts.failed > 0) {
    return `${counts.failed} failed`;
  }
  if (counts.uploading > 0) {
    return `Uploading ${counts.uploading}`;
  }
  if (counts.waiting > 0) {
    return `${counts.waiting} photo${counts.waiting === 1 ? "" : "s"} waiting`;
  }
  return null;
}

export function photoQueueItemContext(item: QueuedPhotoUpload): string {
  if (item.workOrderId) return `Work order ${item.workOrderId}`;
  if (item.intakeDraftId) return `Intake draft ${item.intakeDraftId}`;
  return "This device";
}
