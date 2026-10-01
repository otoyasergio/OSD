import { describe, expect, it, vi } from "vitest";
import { PhotoUploadQueueRunner } from "@/lib/photos/uploadQueue/runner";
import { assertPhotoUploadTransition } from "@/lib/photos/uploadQueue/stateTransitions";
import type { PhotoUploadScope, QueuedPhotoUpload } from "@/lib/photos/uploadQueue/types";
import {
  createMemoryPhotoUploadQueueDatabase,
  MemoryPhotoUploadQueueStore,
} from "@/tests/helpers/memoryPhotoUploadQueueStore";
import { IndexedDbPhotoUploadQueueStore } from "@/lib/photos/uploadQueue/indexedDbStore";
import { createTransactionalPhotoUploadQueueDatabase } from "@/tests/helpers/transactionalPhotoUploadQueueDatabase";

const SCOPE: PhotoUploadScope = {
  userId: "user-a",
  locationId: "location-a",
};

function draftPhoto(overrides: Partial<QueuedPhotoUpload> = {}): QueuedPhotoUpload {
  return {
    queueId: "draft-queue-1",
    clientUploadId: "client-draft-1",
    userId: SCOPE.userId,
    locationId: SCOPE.locationId,
    intakeDraftId: "intake-draft-1",
    category: "front",
    blob: new Blob(["front-bytes"], { type: "image/jpeg" }),
    fileName: "front.jpg",
    mimeType: "image/jpeg",
    lastModified: 900,
    pixelWidth: 640,
    pixelHeight: 480,
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

function workOrderPhoto(overrides: Partial<QueuedPhotoUpload> = {}): QueuedPhotoUpload {
  return {
    ...draftPhoto({
      queueId: "wo-queue-1",
      clientUploadId: "client-wo-1",
      category: "damage",
    }),
    workOrderId: "work-order-1",
    ...overrides,
  } as QueuedPhotoUpload;
}

describe("photo upload queue integration API", () => {
  it("allows a failed entry to return to queued for a manual retry", () => {
    expect(() => assertPhotoUploadTransition("failed", "queued")).not.toThrow();
  });

  it("does not upload draft entries that have no work order id", async () => {
    const store = new MemoryPhotoUploadQueueStore(createMemoryPhotoUploadQueueDatabase());
    await store.put(SCOPE, draftPhoto());
    const uploader = vi.fn(async () => ({ ok: true as const, photoId: "photo-1" }));
    const runner = new PhotoUploadQueueRunner({
      scope: SCOPE,
      store,
      uploader,
      now: () => 2_000,
      timer: { setTimeout: () => 1, clearTimeout: () => undefined },
      isOnline: () => true,
      isVisible: () => true,
      eventTarget: new EventTarget(),
      ownerId: "runner-a",
    });

    await runner.start();
    await runner.stop();

    expect(uploader).not.toHaveBeenCalled();
    await expect(store.get("draft-queue-1", SCOPE)).resolves.toMatchObject({
      status: "queued",
      intakeDraftId: "intake-draft-1",
    });
    expect(await store.get("draft-queue-1", SCOPE)).not.toHaveProperty("workOrderId");
  });

  it("attaches every scoped draft entry to a work order in one commit", async () => {
    const database = createTransactionalPhotoUploadQueueDatabase();
    const store = new IndexedDbPhotoUploadQueueStore({
      openDatabase: database.openDatabase,
    });
    await store.put(SCOPE, draftPhoto({ queueId: "front", category: "front" }));
    await store.put(
      SCOPE,
      draftPhoto({
        queueId: "rear",
        clientUploadId: "client-draft-2",
        category: "rear",
        fileName: "rear.jpg",
      })
    );
    await store.put(
      { userId: "user-b", locationId: SCOPE.locationId },
      draftPhoto({
        queueId: "other-user",
        clientUploadId: "client-other",
        userId: "user-b",
        intakeDraftId: "intake-draft-1",
        category: "vin",
      })
    );

    const gate = database.pauseNextCommit();
    let settled = false;
    const attach = store
      .attachDraftToWorkOrder(SCOPE, "intake-draft-1", "work-order-9", 5_000)
      .then((items) => {
        settled = true;
        return items;
      });
    await gate.started;
    expect(settled).toBe(false);
    expect(
      database.committedItems().filter((item) => item.queueId === "front")
    ).toMatchObject([{ intakeDraftId: "intake-draft-1" }]);

    gate.release();
    const attached = await attach;
    expect(attached).toHaveLength(2);
    expect(attached.map((item) => item.queueId).sort()).toEqual(["front", "rear"]);
    expect(attached.every((item) => item.workOrderId === "work-order-9")).toBe(true);
    expect(attached.every((item) => !("intakeDraftId" in item))).toBe(true);

    const listed = await store.list(SCOPE);
    expect(listed).toHaveLength(2);
    expect(listed.every((item) => item.workOrderId === "work-order-9")).toBe(true);
  });

  it("resets a failed entry to queued with a clean attempt count", async () => {
    const store = new MemoryPhotoUploadQueueStore(createMemoryPhotoUploadQueueDatabase());
    await store.put(
      SCOPE,
      workOrderPhoto({
        status: "failed",
        attemptCount: 5,
        lastError: "Could not upload the photo. Try again.",
        retryAt: null,
      })
    );

    const retried = await store.retryFailed("wo-queue-1", SCOPE, 8_000);

    expect(retried).toMatchObject({
      queueId: "wo-queue-1",
      status: "queued",
      attemptCount: 0,
      lastError: null,
      retryAt: null,
      updatedAt: 8_000,
    });
  });

  it("removes a pending or failed item only when it is not actively claimed", async () => {
    const store = new MemoryPhotoUploadQueueStore(createMemoryPhotoUploadQueueDatabase());
    await store.put(SCOPE, workOrderPhoto({ queueId: "pending", status: "queued" }));
    await store.put(
      SCOPE,
      workOrderPhoto({
        queueId: "failed",
        clientUploadId: "client-failed",
        status: "failed",
        attemptCount: 5,
        lastError: "Permanent failure",
      })
    );
    await store.put(
      SCOPE,
      workOrderPhoto({
        queueId: "claimed",
        clientUploadId: "client-claimed",
        status: "uploading",
        leaseOwner: "runner-a",
        leaseExpiresAt: 9_000,
        uploadSlotOwner: "runner-a",
        uploadSlotExpiresAt: 9_000,
      })
    );

    await expect(store.removeUnclaimed("pending", SCOPE, 2_000)).resolves.toBe(true);
    await expect(store.removeUnclaimed("failed", SCOPE, 2_000)).resolves.toBe(true);
    await expect(store.removeUnclaimed("claimed", SCOPE, 2_000)).resolves.toBe(false);

    await expect(store.get("pending", SCOPE)).resolves.toBeNull();
    await expect(store.get("failed", SCOPE)).resolves.toBeNull();
    await expect(store.get("claimed", SCOPE)).resolves.toMatchObject({
      status: "uploading",
      leaseOwner: "runner-a",
    });
  });

  it("replaces one draft category without leaving an older duplicate queued", async () => {
    const store = new MemoryPhotoUploadQueueStore(createMemoryPhotoUploadQueueDatabase());
    await store.put(SCOPE, draftPhoto({ queueId: "old-front", category: "front" }));
    await store.put(
      SCOPE,
      draftPhoto({
        queueId: "keep-rear",
        clientUploadId: "client-rear",
        category: "rear",
        fileName: "rear.jpg",
      })
    );

    const replacement = draftPhoto({
      queueId: "new-front",
      clientUploadId: "client-front-2",
      category: "front",
      fileName: "front-retake.jpg",
      createdAt: 3_000,
      updatedAt: 3_000,
    });
    const replaced = await store.replaceDraftCategory(
      SCOPE,
      "intake-draft-1",
      "front",
      replacement,
      3_000
    );

    expect(replaced).toMatchObject({
      queueId: "new-front",
      fileName: "front-retake.jpg",
      intakeDraftId: "intake-draft-1",
    });
    const listed = await store.list(SCOPE);
    expect(listed.map((item) => item.queueId).sort()).toEqual(["keep-rear", "new-front"]);
    expect(listed.filter((item) => item.category === "front")).toHaveLength(1);
  });
});
