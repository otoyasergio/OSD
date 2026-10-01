import type { IntakePhotoSelection } from "@/components/forms/IntakePhotoSlots";
import type { PhotoCategory } from "@/lib/database/types";
import type { PhotoUploadQueueApi } from "@/components/photos/PhotoUploadQueueProvider";
import { PhotoQueuePersistenceError } from "@/lib/photos/uploadQueue/errors";
import { fileFromQueuedPhoto } from "@/lib/photos/uploadQueue/prepareQueuedPhoto";
import type { QueuedPhotoUpload } from "@/lib/photos/uploadQueue/types";

export const INTAKE_PHOTOS_RESTORED = "Photos restored on this device.";
export const INTAKE_PHOTO_NOT_SAVED = "This photo could not be saved on this device.";

export function persistQueueErrorMessage(error: unknown): string {
  if (error instanceof PhotoQueuePersistenceError) return error.message;
  return INTAKE_PHOTO_NOT_SAVED;
}

export function requiredQueueIdsForIntake(
  items: QueuedPhotoUpload[],
  categories: readonly string[],
  match: { intakeDraftId?: string; workOrderId?: string }
): string[] {
  const wanted = new Set(categories);
  return items
    .filter((item) => {
      if (!wanted.has(item.category)) return false;
      if (match.workOrderId) return item.workOrderId === match.workOrderId;
      if (match.intakeDraftId) return item.intakeDraftId === match.intakeDraftId;
      return false;
    })
    .map((item) => item.queueId);
}

export function intakeContractHref(
  workOrderId: string,
  optionalPhotoFailures = 0
): string {
  const params = new URLSearchParams({ from: "intake" });
  if (optionalPhotoFailures > 0) {
    params.set("extra_photo_failures", String(optionalPhotoFailures));
  }
  return `/work_orders/${workOrderId}/contract?${params.toString()}`;
}

export function filesFromQueuedIntakeItems(
  items: QueuedPhotoUpload[]
): IntakePhotoSelection {
  const next: IntakePhotoSelection = {};
  for (const item of items) {
    if (item.category === "other") continue;
    next[item.category as PhotoCategory] = fileFromQueuedPhoto(item);
  }
  return next;
}

export function extraFilesFromQueuedIntakeItems(items: QueuedPhotoUpload[]): File[] {
  return items
    .filter((item) => item.category === "other")
    .sort((left, right) => left.createdAt - right.createdAt)
    .map((item) => fileFromQueuedPhoto(item));
}

export async function attachAndWaitForRequiredIntakePhotos({
  queue,
  intakeDraftId,
  workOrderId,
  requiredQueueIds,
}: {
  queue: Pick<PhotoUploadQueueApi, "attachDraftToWorkOrder" | "waitForConfirmations">;
  intakeDraftId: string;
  workOrderId: string;
  requiredQueueIds: string[];
}): Promise<{ ok: true } | { ok: false; failedCategories: string[] }> {
  await queue.attachDraftToWorkOrder(intakeDraftId, workOrderId);
  const waited = await queue.waitForConfirmations(requiredQueueIds);
  if (waited.ok) return { ok: true };
  return {
    ok: false,
    failedCategories: waited.failed.map((item) => item.category),
  };
}

export async function waitForRequiredIntakePhotos({
  queue,
  requiredQueueIds,
}: {
  queue: Pick<PhotoUploadQueueApi, "waitForConfirmations">;
  requiredQueueIds: string[];
}): Promise<{ ok: true } | { ok: false; failedCategories: string[] }> {
  const waited = await queue.waitForConfirmations(requiredQueueIds);
  if (waited.ok) return { ok: true };
  return {
    ok: false,
    failedCategories: waited.failed.map((item) => item.category),
  };
}
