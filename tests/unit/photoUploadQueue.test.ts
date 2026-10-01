import { describe, expect, it, vi } from "vitest";
import {
  enqueuePhotoUpload,
  PhotoQueuePersistenceError,
} from "@/lib/photos/uploadQueue/enqueue";
import {
  assertPhotoUploadTransition,
  InvalidPhotoUploadTransitionError,
} from "@/lib/photos/uploadQueue/stateTransitions";
import {
  IndexedDbPhotoUploadQueueStore,
  PHOTO_UPLOAD_QUEUE_DB_NAME,
  PHOTO_UPLOAD_QUEUE_DB_VERSION,
} from "@/lib/photos/uploadQueue/indexedDbStore";
import { PhotoUploadQueueRunner } from "@/lib/photos/uploadQueue/runner";
import type { PhotoUploadScope, QueuedPhotoUpload } from "@/lib/photos/uploadQueue/types";
import {
  createMemoryPhotoUploadQueueDatabase,
  MemoryPhotoUploadQueueStore,
} from "@/tests/helpers/memoryPhotoUploadQueueStore";

const SCOPE: PhotoUploadScope = {
  userId: "user-a",
  locationId: "location-a",
};

function queuedPhoto(overrides: Partial<QueuedPhotoUpload> = {}): QueuedPhotoUpload {
  return {
    queueId: "queue-1",
    clientUploadId: "client-upload-1",
    userId: SCOPE.userId,
    locationId: SCOPE.locationId,
    workOrderId: "work-order-1",
    category: "damage",
    blob: new Blob(["photo-bytes"], { type: "image/jpeg" }),
    fileName: "damage.jpg",
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
    ...overrides,
  } as QueuedPhotoUpload;
}

class ManualClockTimer {
  now = 2_000;
  private nextId = 1;
  private readonly tasks = new Map<number, { runAt: number; callback: () => void }>();

  setTimeout = (callback: () => void, delayMs: number): number => {
    const id = this.nextId++;
    this.tasks.set(id, { runAt: this.now + delayMs, callback });
    return id;
  };

  clearTimeout = (handle: unknown): void => {
    this.tasks.delete(handle as number);
  };

  advanceBy(ms: number): void {
    this.now += ms;
    const due = [...this.tasks.entries()]
      .filter(([, task]) => task.runAt <= this.now)
      .sort(([, left], [, right]) => left.runAt - right.runAt);
    for (const [id, task] of due) {
      this.tasks.delete(id);
      task.callback();
    }
  }

  get nextDelay(): number | null {
    const next = [...this.tasks.values()].sort(
      (left, right) => left.runAt - right.runAt
    )[0];
    return next ? next.runAt - this.now : null;
  }
}

describe("photo upload queue persistence", () => {
  it("survives a new store instance", async () => {
    const database = createMemoryPhotoUploadQueueDatabase();
    const firstStore = new MemoryPhotoUploadQueueStore(database);
    await firstStore.put(SCOPE, queuedPhoto());

    const reopenedStore = new MemoryPhotoUploadQueueStore(database);

    await expect(reopenedStore.list(SCOPE)).resolves.toMatchObject([
      {
        queueId: "queue-1",
        clientUploadId: "client-upload-1",
        fileName: "damage.jpg",
      },
    ]);
  });

  it("opens a versioned database and reports queued only after commit", async () => {
    const records = new Map<string, QueuedPhotoUpload>();
    let autoCommit = false;
    let commitNext: () => void = () => {};
    const openDatabase = vi.fn(async () => ({
      transaction: () => {
        const staged = new Map(records);
        let commit: () => void = () => {};
        const done = new Promise<void>((resolve) => {
          commit = () => {
            records.clear();
            for (const [key, value] of staged) records.set(key, value);
            resolve();
          };
        });
        if (autoCommit) queueMicrotask(commit);
        else commitNext = commit;
        return {
          get: async (queueId: string) => staged.get(queueId),
          listByScope: async (scope: PhotoUploadScope) =>
            [...staged.values()].filter(
              (item) =>
                item.userId === scope.userId && item.locationId === scope.locationId
            ),
          put: async (item: QueuedPhotoUpload) => {
            staged.set(item.queueId, structuredClone(item));
          },
          delete: async (queueId: string) => {
            staged.delete(queueId);
          },
          done,
        };
      },
    }));
    const firstStore = new IndexedDbPhotoUploadQueueStore({ openDatabase });
    let enqueueSettled = false;
    const enqueue = enqueuePhotoUpload({
      store: firstStore,
      scope: SCOPE,
      item: queuedPhoto({ status: "preparing" }),
      now: 2_000,
    }).then((item) => {
      enqueueSettled = true;
      return item;
    });
    await vi.waitFor(() => expect(openDatabase).toHaveBeenCalledTimes(1));
    await Promise.resolve();

    expect(enqueueSettled).toBe(false);
    expect(records.size).toBe(0);

    autoCommit = true;
    commitNext();
    await expect(enqueue).resolves.toMatchObject({ status: "queued" });
    expect(openDatabase).toHaveBeenCalledWith(
      PHOTO_UPLOAD_QUEUE_DB_NAME,
      PHOTO_UPLOAD_QUEUE_DB_VERSION
    );

    const reopenedStore = new IndexedDbPhotoUploadQueueStore({ openDatabase });
    await expect(reopenedStore.list(SCOPE)).resolves.toMatchObject([
      { queueId: "queue-1", status: "queued" },
    ]);
  });

  it("recovers an interrupted uploading entry to queued", async () => {
    const store = new MemoryPhotoUploadQueueStore(createMemoryPhotoUploadQueueDatabase());
    await store.put(
      SCOPE,
      queuedPhoto({
        status: "uploading",
        attemptCount: 1,
        updatedAt: 1_100,
      })
    );

    await expect(store.recoverInterrupted(SCOPE, 2_000)).resolves.toBe(1);
    await expect(store.get("queue-1", SCOPE)).resolves.toMatchObject({
      status: "queued",
      attemptCount: 1,
      retryAt: null,
      updatedAt: 2_000,
    });
  });

  it("scopes listing and mutation by both user and location", async () => {
    const store = new MemoryPhotoUploadQueueStore(createMemoryPhotoUploadQueueDatabase());
    const otherUserScope = { ...SCOPE, userId: "user-b" };
    const otherLocationScope = { ...SCOPE, locationId: "location-b" };
    await store.put(SCOPE, queuedPhoto());
    await store.put(
      otherUserScope,
      queuedPhoto({
        queueId: "queue-other-user",
        clientUploadId: "client-other-user",
        userId: otherUserScope.userId,
      })
    );
    await store.put(
      otherLocationScope,
      queuedPhoto({
        queueId: "queue-other-location",
        clientUploadId: "client-other-location",
        locationId: otherLocationScope.locationId,
      })
    );

    await expect(store.list(SCOPE)).resolves.toMatchObject([{ queueId: "queue-1" }]);
    await expect(store.get("queue-other-user", SCOPE)).resolves.toBeNull();
    await expect(
      store.update("queue-other-user", SCOPE, { status: "failed" })
    ).resolves.toBeNull();
    await store.remove("queue-other-location", SCOPE);
    await expect(
      store.get("queue-other-location", otherLocationScope)
    ).resolves.toMatchObject({ status: "queued" });
  });

  it("does not overwrite another scope when queue IDs collide", async () => {
    const store = new MemoryPhotoUploadQueueStore(createMemoryPhotoUploadQueueDatabase());
    const otherScope = { ...SCOPE, userId: "user-b" };
    await store.put(
      otherScope,
      queuedPhoto({
        userId: otherScope.userId,
        fileName: "other-user.jpg",
      })
    );

    await expect(store.put(SCOPE, queuedPhoto())).rejects.toThrow(/scope/i);
    await expect(store.get("queue-1", otherScope)).resolves.toMatchObject({
      userId: "user-b",
      fileName: "other-user.jpg",
    });
  });

  it("allows an expired item lease to be claimed by another runner", async () => {
    const store = new MemoryPhotoUploadQueueStore(createMemoryPhotoUploadQueueDatabase());
    await store.put(SCOPE, queuedPhoto());
    await expect(
      store.tryAcquireLease("queue-1", SCOPE, "runner-a", 2_000, 1_000)
    ).resolves.toBe(true);
    await expect(
      store.tryAcquireLease("queue-1", SCOPE, "runner-b", 2_999, 1_000)
    ).resolves.toBe(false);

    await expect(
      store.tryAcquireLease("queue-1", SCOPE, "runner-b", 3_000, 1_000)
    ).resolves.toBe(true);
    await expect(store.get("queue-1", SCOPE)).resolves.toMatchObject({
      leaseOwner: "runner-b",
      leaseExpiresAt: 4_000,
    });
  });

  it("rejects enqueue with a typed quota error and leaves no phantom item", async () => {
    const database = createMemoryPhotoUploadQueueDatabase();
    class QuotaFailingStore extends MemoryPhotoUploadQueueStore {
      override async put(): Promise<void> {
        throw new DOMException("Storage quota exceeded.", "QuotaExceededError");
      }
    }
    const store = new QuotaFailingStore(database);

    const enqueue = enqueuePhotoUpload({
      store,
      scope: SCOPE,
      item: queuedPhoto({ status: "preparing" }),
      now: 2_000,
    });

    await expect(enqueue).rejects.toMatchObject({
      name: "PhotoQueuePersistenceError",
      code: "quota_exceeded",
    });
    await expect(enqueue).rejects.toBeInstanceOf(PhotoQueuePersistenceError);
    await expect(store.list(SCOPE)).resolves.toEqual([]);
  });
});

describe("photo upload queue state transitions", () => {
  it("accepts the upload lifecycle including a retry", () => {
    expect(() => assertPhotoUploadTransition("preparing", "queued")).not.toThrow();
    expect(() => assertPhotoUploadTransition("queued", "uploading")).not.toThrow();
    expect(() => assertPhotoUploadTransition("uploading", "retry_wait")).not.toThrow();
    expect(() => assertPhotoUploadTransition("retry_wait", "uploading")).not.toThrow();
    expect(() => assertPhotoUploadTransition("uploading", "saved")).not.toThrow();
  });

  it("rejects transitions outside the upload lifecycle", () => {
    expect(() => assertPhotoUploadTransition("queued", "saved")).toThrowError(
      InvalidPhotoUploadTransitionError
    );
    expect(() => assertPhotoUploadTransition("failed", "uploading")).toThrow(
      /failed.*uploading/i
    );
  });
});

describe("PhotoUploadQueueRunner", () => {
  it("removes an item only after the uploader confirms it was saved", async () => {
    const store = new MemoryPhotoUploadQueueStore(createMemoryPhotoUploadQueueDatabase());
    await store.put(SCOPE, queuedPhoto());
    let confirmSaved: (photoId: string) => void = () => {};
    const uploader = vi.fn(
      () =>
        new Promise<{ ok: true; photoId: string }>((resolve) => {
          confirmSaved = (photoId) => resolve({ ok: true, photoId });
        })
    );
    const runner = new PhotoUploadQueueRunner({
      scope: SCOPE,
      store,
      uploader,
      now: () => 2_000,
      timer: {
        setTimeout: () => 1,
        clearTimeout: () => undefined,
      },
      isOnline: () => true,
      isVisible: () => true,
      eventTarget: new EventTarget(),
      ownerId: "runner-a",
    });

    const running = runner.start();
    await vi.waitFor(() => expect(uploader).toHaveBeenCalledTimes(1));
    await expect(store.get("queue-1", SCOPE)).resolves.toMatchObject({
      status: "uploading",
    });

    confirmSaved("photo-1");
    await running;

    await expect(store.get("queue-1", SCOPE)).resolves.toBeNull();
    runner.stop();
  });

  it("backs off a retryable failure and retries when the delay expires", async () => {
    const store = new MemoryPhotoUploadQueueStore(createMemoryPhotoUploadQueueDatabase());
    await store.put(SCOPE, queuedPhoto());
    const timer = new ManualClockTimer();
    const uploader = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        retryable: true,
        message: "Network unavailable",
      })
      .mockResolvedValueOnce({ ok: true, photoId: "photo-1" });
    const runner = new PhotoUploadQueueRunner({
      scope: SCOPE,
      store,
      uploader,
      now: () => timer.now,
      timer,
      isOnline: () => true,
      isVisible: () => true,
      eventTarget: new EventTarget(),
      ownerId: "runner-a",
      baseRetryDelayMs: 1_000,
      maxRetryDelayMs: 8_000,
    });

    await runner.start();

    await expect(store.get("queue-1", SCOPE)).resolves.toMatchObject({
      status: "retry_wait",
      attemptCount: 1,
      retryAt: 3_000,
      lastError: "Network unavailable",
    });
    expect(timer.nextDelay).toBe(1_000);

    timer.advanceBy(999);
    await runner.wake();
    expect(uploader).toHaveBeenCalledTimes(1);

    timer.advanceBy(1);
    await runner.wake();
    expect(uploader).toHaveBeenCalledTimes(2);
    await expect(store.get("queue-1", SCOPE)).resolves.toBeNull();
    runner.stop();
  });

  it("treats a rejected uploader promise as a retryable failure", async () => {
    const store = new MemoryPhotoUploadQueueStore(createMemoryPhotoUploadQueueDatabase());
    await store.put(SCOPE, queuedPhoto());
    const timer = new ManualClockTimer();
    const runner = new PhotoUploadQueueRunner({
      scope: SCOPE,
      store,
      uploader: vi.fn().mockRejectedValue(new Error("Failed to fetch")),
      now: () => timer.now,
      timer,
      isOnline: () => true,
      isVisible: () => true,
      eventTarget: new EventTarget(),
      ownerId: "runner-a",
      baseRetryDelayMs: 1_000,
    });

    await runner.start();

    await expect(store.get("queue-1", SCOPE)).resolves.toMatchObject({
      status: "retry_wait",
      retryAt: 3_000,
      lastError: "Failed to fetch",
      leaseOwner: null,
    });
    runner.stop();
  });

  it("stops retrying after the bounded attempt limit", async () => {
    const store = new MemoryPhotoUploadQueueStore(createMemoryPhotoUploadQueueDatabase());
    await store.put(SCOPE, queuedPhoto());
    const timer = new ManualClockTimer();
    const uploader = vi.fn().mockResolvedValue({
      ok: false,
      retryable: true,
      message: "Network unavailable",
    });
    const runner = new PhotoUploadQueueRunner({
      scope: SCOPE,
      store,
      uploader,
      now: () => timer.now,
      timer,
      isOnline: () => true,
      isVisible: () => true,
      eventTarget: new EventTarget(),
      ownerId: "runner-a",
      baseRetryDelayMs: 1_000,
      maxAttempts: 2,
    });

    await runner.start();
    timer.advanceBy(1_000);
    await runner.wake();

    expect(uploader).toHaveBeenCalledTimes(2);
    await expect(store.get("queue-1", SCOPE)).resolves.toMatchObject({
      status: "failed",
      attemptCount: 2,
      retryAt: null,
      lastError: "Network unavailable",
    });
    expect(timer.nextDelay).toBeNull();
    runner.stop();
  });

  it("keeps a permanent failure stored in an actionable failed state", async () => {
    const store = new MemoryPhotoUploadQueueStore(createMemoryPhotoUploadQueueDatabase());
    await store.put(SCOPE, queuedPhoto());
    const timer = new ManualClockTimer();
    const runner = new PhotoUploadQueueRunner({
      scope: SCOPE,
      store,
      uploader: async () => ({
        ok: false,
        retryable: false,
        message: "This photo type is not supported.",
      }),
      now: () => timer.now,
      timer,
      isOnline: () => true,
      isVisible: () => true,
      eventTarget: new EventTarget(),
      ownerId: "runner-a",
    });

    await runner.start();

    const failed = await store.get("queue-1", SCOPE);
    expect(failed).toMatchObject({
      status: "failed",
      attemptCount: 1,
      retryAt: null,
      lastError: "This photo type is not supported.",
    });
    expect(await failed?.blob.text()).toBe("photo-bytes");
    runner.stop();
  });

  it("pauses while offline and resumes on the online event", async () => {
    const store = new MemoryPhotoUploadQueueStore(createMemoryPhotoUploadQueueDatabase());
    await store.put(SCOPE, queuedPhoto());
    const timer = new ManualClockTimer();
    const events = new EventTarget();
    let online = false;
    const uploader = vi.fn().mockResolvedValue({
      ok: true,
      photoId: "photo-1",
    });
    const runner = new PhotoUploadQueueRunner({
      scope: SCOPE,
      store,
      uploader,
      now: () => timer.now,
      timer,
      isOnline: () => online,
      isVisible: () => true,
      eventTarget: events,
      ownerId: "runner-a",
    });

    await runner.start();

    expect(uploader).not.toHaveBeenCalled();
    await expect(store.get("queue-1", SCOPE)).resolves.toMatchObject({
      status: "queued",
    });

    online = true;
    events.dispatchEvent(new Event("online"));
    await vi.waitFor(() => expect(uploader).toHaveBeenCalledTimes(1));
    await vi.waitFor(async () => {
      expect(await store.get("queue-1", SCOPE)).toBeNull();
    });
    runner.stop();
  });

  it.each(["pageshow", "visibilitychange"])(
    "resumes on %s when the page is visible",
    async (eventName) => {
      const store = new MemoryPhotoUploadQueueStore(
        createMemoryPhotoUploadQueueDatabase()
      );
      await store.put(SCOPE, queuedPhoto());
      const timer = new ManualClockTimer();
      const events = new EventTarget();
      let visible = false;
      const uploader = vi.fn().mockResolvedValue({
        ok: true,
        photoId: "photo-1",
      });
      const runner = new PhotoUploadQueueRunner({
        scope: SCOPE,
        store,
        uploader,
        now: () => timer.now,
        timer,
        isOnline: () => true,
        isVisible: () => visible,
        eventTarget: events,
        ownerId: "runner-a",
      });
      await runner.start();
      expect(uploader).not.toHaveBeenCalled();

      visible = true;
      events.dispatchEvent(new Event(eventName));

      await vi.waitFor(() => expect(uploader).toHaveBeenCalledTimes(1));
      await vi.waitFor(async () => {
        expect(await store.get("queue-1", SCOPE)).toBeNull();
      });
      runner.stop();
    }
  );

  it("runs no more than two uploads concurrently", async () => {
    const store = new MemoryPhotoUploadQueueStore(createMemoryPhotoUploadQueueDatabase());
    for (let index = 1; index <= 3; index += 1) {
      await store.put(
        SCOPE,
        queuedPhoto({
          queueId: `queue-${index}`,
          clientUploadId: `client-upload-${index}`,
        })
      );
    }
    const timer = new ManualClockTimer();
    let activeUploads = 0;
    let maximumActiveUploads = 0;
    const releases: Array<() => void> = [];
    const uploader = vi.fn(
      () =>
        new Promise<{ ok: true; photoId: string }>((resolve) => {
          activeUploads += 1;
          maximumActiveUploads = Math.max(maximumActiveUploads, activeUploads);
          const photoId = `photo-${releases.length + 1}`;
          releases.push(() => {
            activeUploads -= 1;
            resolve({ ok: true, photoId });
          });
        })
    );
    const runner = new PhotoUploadQueueRunner({
      scope: SCOPE,
      store,
      uploader,
      now: () => timer.now,
      timer,
      isOnline: () => true,
      isVisible: () => true,
      eventTarget: new EventTarget(),
      ownerId: "runner-a",
    });

    const running = runner.start();
    await vi.waitFor(() => expect(uploader).toHaveBeenCalledTimes(2));
    expect(maximumActiveUploads).toBe(2);

    releases[0]();
    await vi.waitFor(() => expect(uploader).toHaveBeenCalledTimes(3));
    expect(maximumActiveUploads).toBe(2);

    releases[1]();
    releases[2]();
    await running;
    await expect(store.list(SCOPE)).resolves.toEqual([]);
    runner.stop();
  });

  it("uses a live item lease to block a second runner", async () => {
    const store = new MemoryPhotoUploadQueueStore(createMemoryPhotoUploadQueueDatabase());
    await store.put(SCOPE, queuedPhoto());
    const timer = new ManualClockTimer();
    let finishFirstUpload: () => void = () => {};
    const firstUploader = vi.fn(
      () =>
        new Promise<{ ok: true; photoId: string }>((resolve) => {
          finishFirstUpload = () => resolve({ ok: true, photoId: "photo-1" });
        })
    );
    const secondUploader = vi.fn().mockResolvedValue({
      ok: true,
      photoId: "photo-2",
    });
    const sharedOptions = {
      scope: SCOPE,
      store,
      now: () => timer.now,
      timer,
      isOnline: () => true,
      isVisible: () => true,
      eventTarget: new EventTarget(),
      leaseTtlMs: 10_000,
    };
    const firstRunner = new PhotoUploadQueueRunner({
      ...sharedOptions,
      uploader: firstUploader,
      ownerId: "runner-a",
    });
    const secondRunner = new PhotoUploadQueueRunner({
      ...sharedOptions,
      uploader: secondUploader,
      ownerId: "runner-b",
    });

    const firstRunning = firstRunner.start();
    await vi.waitFor(() => expect(firstUploader).toHaveBeenCalledTimes(1));
    await secondRunner.start();

    expect(secondUploader).not.toHaveBeenCalled();

    finishFirstUpload();
    await firstRunning;
    firstRunner.stop();
    secondRunner.stop();
  });

  it("renews the expiring lease while an upload remains active", async () => {
    const store = new MemoryPhotoUploadQueueStore(createMemoryPhotoUploadQueueDatabase());
    await store.put(SCOPE, queuedPhoto());
    const timer = new ManualClockTimer();
    let finishUpload: () => void = () => {};
    const runner = new PhotoUploadQueueRunner({
      scope: SCOPE,
      store,
      uploader: () =>
        new Promise<{ ok: true; photoId: string }>((resolve) => {
          finishUpload = () => resolve({ ok: true, photoId: "photo-1" });
        }),
      now: () => timer.now,
      timer,
      isOnline: () => true,
      isVisible: () => true,
      eventTarget: new EventTarget(),
      ownerId: "runner-a",
      leaseTtlMs: 1_000,
    });

    const running = runner.start();
    await vi.waitFor(async () => {
      expect(await store.get("queue-1", SCOPE)).toMatchObject({
        status: "uploading",
        leaseExpiresAt: 3_000,
      });
    });

    timer.advanceBy(500);
    await vi.waitFor(async () => {
      expect(await store.get("queue-1", SCOPE)).toMatchObject({
        leaseOwner: "runner-a",
        leaseExpiresAt: 3_500,
      });
    });

    finishUpload();
    await running;
    runner.stop();
  });

  it("recovers and claims an interrupted item when its live lease expires", async () => {
    const store = new MemoryPhotoUploadQueueStore(createMemoryPhotoUploadQueueDatabase());
    await store.put(
      SCOPE,
      queuedPhoto({
        status: "uploading",
        attemptCount: 1,
        leaseOwner: "closed-tab",
        leaseExpiresAt: 3_000,
      })
    );
    const timer = new ManualClockTimer();
    const uploader = vi.fn().mockResolvedValue({
      ok: true,
      photoId: "photo-1",
    });
    const runner = new PhotoUploadQueueRunner({
      scope: SCOPE,
      store,
      uploader,
      now: () => timer.now,
      timer,
      isOnline: () => true,
      isVisible: () => true,
      eventTarget: new EventTarget(),
      ownerId: "runner-b",
    });

    await runner.start();
    expect(uploader).not.toHaveBeenCalled();
    expect(timer.nextDelay).toBe(1_000);

    timer.advanceBy(1_000);
    await runner.wake();

    expect(uploader).toHaveBeenCalledTimes(1);
    await expect(store.get("queue-1", SCOPE)).resolves.toBeNull();
    runner.stop();
  });

  it("waits for a competing lease instead of spinning on an overdue retry", async () => {
    const store = new MemoryPhotoUploadQueueStore(createMemoryPhotoUploadQueueDatabase());
    await store.put(
      SCOPE,
      queuedPhoto({
        status: "retry_wait",
        attemptCount: 1,
        retryAt: 1_500,
        leaseOwner: "runner-a",
        leaseExpiresAt: 3_000,
      })
    );
    const timer = new ManualClockTimer();
    const uploader = vi.fn().mockResolvedValue({
      ok: true,
      photoId: "photo-1",
    });
    const runner = new PhotoUploadQueueRunner({
      scope: SCOPE,
      store,
      uploader,
      now: () => timer.now,
      timer,
      isOnline: () => true,
      isVisible: () => true,
      eventTarget: new EventTarget(),
      ownerId: "runner-b",
    });

    await runner.start();

    expect(uploader).not.toHaveBeenCalled();
    expect(timer.nextDelay).toBe(1_000);
    runner.stop();
  });
});
