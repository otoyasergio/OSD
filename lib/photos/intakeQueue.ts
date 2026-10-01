import type { IntakePhotoSelection } from "@/components/forms/IntakePhotoSlots";
import type { PhotoCategory } from "@/lib/database/types";
import type { PhotoUploadQueueApi } from "@/components/photos/PhotoUploadQueueProvider";
import { PhotoQueuePersistenceError } from "@/lib/photos/uploadQueue/errors";
import { fileFromQueuedPhoto } from "@/lib/photos/uploadQueue/prepareQueuedPhoto";
import type { QueuedPhotoUpload } from "@/lib/photos/uploadQueue/types";

export const INTAKE_PHOTOS_RESTORED = "Photos restored on this device.";
export const INTAKE_PHOTO_NOT_SAVED = "This photo could not be saved on this device.";
export const INTAKE_DRAFT_HYDRATING_COPY = "Restoring saved photos on this device…";

export function persistQueueErrorMessage(error: unknown): string {
  if (error instanceof PhotoQueuePersistenceError) return error.message;
  return INTAKE_PHOTO_NOT_SAVED;
}

export function requiredQueueIdsForRemainingCategories({
  remaining,
  workOrderId,
  items,
  receipts,
  preferredByCategory = {},
}: {
  remaining: readonly string[];
  workOrderId: string;
  items: Array<{ queueId: string; category: string; workOrderId?: string }>;
  receipts: Array<{ queueId: string; category?: string; workOrderId?: string }>;
  preferredByCategory?: Partial<Record<string, string>>;
}): { queueIds: string[]; missingCategories: string[] } {
  const liveIds = new Set<string>();
  for (const item of items) {
    if (item.workOrderId === workOrderId) liveIds.add(item.queueId);
  }
  for (const receipt of receipts) {
    if (receipt.workOrderId === workOrderId) liveIds.add(receipt.queueId);
  }
  const queueIds: string[] = [];
  const missingCategories: string[] = [];
  for (const category of remaining) {
    const preferred = preferredByCategory[category];
    if (preferred && liveIds.has(preferred)) {
      queueIds.push(preferred);
      continue;
    }
    const item = items.find(
      (candidate) =>
        candidate.category === category && candidate.workOrderId === workOrderId
    );
    if (item) {
      queueIds.push(item.queueId);
      continue;
    }
    const receipt = receipts.find(
      (candidate) =>
        candidate.category === category && candidate.workOrderId === workOrderId
    );
    if (receipt) {
      queueIds.push(receipt.queueId);
      continue;
    }
    missingCategories.push(category);
  }
  return { queueIds, missingCategories };
}

export function labelsForRecoveryWaitFailure({
  remaining,
  requiredQueueIds,
  waited,
  stillMissing = [],
}: {
  remaining: readonly string[];
  requiredQueueIds: readonly string[];
  waited: { failed: Array<{ category: string }>; missingQueueIds: string[] };
  stillMissing?: readonly string[];
}): string[] {
  const fromFailed = waited.failed.map((item) => item.category);
  const fromMissingIds = waited.missingQueueIds.flatMap((queueId) => {
    const index = requiredQueueIds.indexOf(queueId);
    return index >= 0 ? [remaining[index]] : [];
  });
  return [
    ...new Set([...stillMissing, ...fromFailed, ...fromMissingIds].filter(Boolean)),
  ];
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

export function requiredAttachedIntakeItems(
  attached: QueuedPhotoUpload[],
  requiredCategories: readonly string[]
): {
  items: QueuedPhotoUpload[];
  missingCategories: string[];
} {
  const items: QueuedPhotoUpload[] = [];
  const missingCategories: string[] = [];
  for (const category of requiredCategories) {
    const match = attached.find((item) => item.category === category);
    if (!match) {
      missingCategories.push(category);
      continue;
    }
    items.push(match);
  }
  return { items, missingCategories };
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
  requiredCategories,
}: {
  queue: Pick<PhotoUploadQueueApi, "attachDraftToWorkOrder" | "waitForConfirmations">;
  intakeDraftId: string;
  workOrderId: string;
  requiredCategories: readonly string[];
}): Promise<{ ok: true } | { ok: false; failedCategories: string[] }> {
  const attached = await queue.attachDraftToWorkOrder(intakeDraftId, workOrderId);
  const { items, missingCategories } = requiredAttachedIntakeItems(
    attached,
    requiredCategories
  );
  if (missingCategories.length > 0 || items.length !== requiredCategories.length) {
    return {
      ok: false,
      failedCategories:
        missingCategories.length > 0 ? missingCategories : [...requiredCategories],
    };
  }
  const waited = await queue.waitForConfirmations(items.map((item) => item.queueId));
  if (waited.ok) return { ok: true };
  const failedFromItems = waited.failed.map((item) => item.category);
  const failedFromMissing = waited.missingQueueIds.flatMap((queueId) => {
    const item = items.find((candidate) => candidate.queueId === queueId);
    return item ? [item.category] : [];
  });
  return {
    ok: false,
    failedCategories: [...new Set([...failedFromItems, ...failedFromMissing])],
  };
}

export async function waitForRequiredIntakePhotos({
  queue,
  requiredQueueIds,
}: {
  queue: Pick<PhotoUploadQueueApi, "waitForConfirmations">;
  requiredQueueIds: string[];
}): Promise<{ ok: true } | { ok: false; failedCategories: string[] }> {
  if (requiredQueueIds.length === 0) {
    return { ok: false, failedCategories: [] };
  }
  const waited = await queue.waitForConfirmations(requiredQueueIds);
  if (waited.ok) return { ok: true };
  return {
    ok: false,
    failedCategories: waited.failed.map((item) => item.category),
  };
}
