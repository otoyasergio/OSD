import { describe, expect, it } from "vitest";
import { IndexedDbPhotoUploadQueueStore } from "@/lib/photos/uploadQueue/indexedDbStore";
import {
  createPhotoUploadQueueStore,
  photoUploadQueueProviderKey,
} from "@/lib/photos/uploadQueue/createStore";
import { VolatilePhotoUploadQueueStore } from "@/lib/photos/uploadQueue/volatileStore";
import type { PhotoUploadScope, QueuedPhotoUpload } from "@/lib/photos/uploadQueue/types";

const SCOPE: PhotoUploadScope = { userId: "user-a", locationId: "location-a" };

function queuedPhoto(overrides: Partial<QueuedPhotoUpload> = {}): QueuedPhotoUpload {
  return {
    queueId: "queue-1",
    clientUploadId: "81111111-1111-4111-8111-111111111111",
    userId: SCOPE.userId,
    locationId: SCOPE.locationId,
    workOrderId: "work-order-1",
    category: "front",
    blob: new Blob(["photo-bytes"], { type: "image/jpeg" }),
    fileName: "front.jpg",
    mimeType: "image/jpeg",
    lastModified: 900,
    byteCount: 11,
    status: "queued",
    attemptCount: 0,
    retryAt: null,
    lastError: null,
    createdAt: 1_000,
    updatedAt: 1_000,
    leaseOwner: null,
    leaseExpiresAt: null,
    uploadSlotOwner: null,
    uploadSlotExpiresAt: null,
    ...overrides,
  } as QueuedPhotoUpload;
}

describe("photo upload queue store modes", () => {
  it("creates a volatile store when the durable flag is off", () => {
    const store = createPhotoUploadQueueStore(false);
    expect(store).toBeInstanceOf(VolatilePhotoUploadQueueStore);
    expect(store).not.toBeInstanceOf(IndexedDbPhotoUploadQueueStore);
  });

  it("creates an IndexedDB store when the durable flag is on", () => {
    const store = createPhotoUploadQueueStore(true);
    expect(store).toBeInstanceOf(IndexedDbPhotoUploadQueueStore);
  });

  it("keys the provider by mode, user, and location so remounts cannot mix stores", () => {
    expect(photoUploadQueueProviderKey(false, "user-a", "loc-a")).toBe(
      "volatile:user-a:loc-a"
    );
    expect(photoUploadQueueProviderKey(true, "user-a", "loc-a")).toBe(
      "durable:user-a:loc-a"
    );
    expect(photoUploadQueueProviderKey(false, "user-a", "loc-a")).not.toBe(
      photoUploadQueueProviderKey(true, "user-a", "loc-a")
    );
  });

  it("keeps queued photos in one volatile instance and loses them in a new instance", async () => {
    const first = new VolatilePhotoUploadQueueStore();
    await first.put(SCOPE, queuedPhoto());
    await expect(first.list(SCOPE)).resolves.toHaveLength(1);

    const second = new VolatilePhotoUploadQueueStore();
    await expect(second.list(SCOPE)).resolves.toEqual([]);
  });

  it("completes a claimed upload and records a confirmation in volatile memory", async () => {
    const store = new VolatilePhotoUploadQueueStore();
    await store.put(SCOPE, queuedPhoto());
    const claim = await store.tryAcquireUploadClaim(
      "queue-1",
      SCOPE,
      "runner-1",
      2_000,
      5_000,
      2,
      5
    );
    expect(claim).not.toBeNull();
    await expect(
      store.completeClaimedUpload("queue-1", SCOPE, "runner-1", 2_100, {
        clientUploadId: "81111111-1111-4111-8111-111111111111",
        photoId: "71111111-1111-4111-8111-111111111111",
      })
    ).resolves.toBe(true);
    await expect(store.list(SCOPE)).resolves.toEqual([]);
    await expect(store.listConfirmations(SCOPE)).resolves.toEqual([
      expect.objectContaining({
        queueId: "queue-1",
        photoId: "71111111-1111-4111-8111-111111111111",
      }),
    ]);
  });
});
