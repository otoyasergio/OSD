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
import {
  PhotoUploadQueueRunner,
  PhotoUploadQueueRunnerError,
} from "@/lib/photos/uploadQueue/runner";
import {
  type AcquiredPhotoUploadClaim,
  type PhotoUploadFailureOutcome,
  type PhotoUploadClaim,
  type PhotoUploadRetryPolicy,
  PHOTO_UPLOAD_MAX_ATTEMPTS_ERROR,
} from "@/lib/photos/uploadQueue/store";
import {
  PHOTO_CONFIRMATION_TTL_MS,
  type PhotoUploadScope,
  type QueuedPhotoUpload,
} from "@/lib/photos/uploadQueue/types";
import {
  createMemoryPhotoUploadQueueDatabase,
  MemoryPhotoUploadQueueStore,
} from "@/tests/helpers/memoryPhotoUploadQueueStore";
import { createTransactionalPhotoUploadQueueDatabase } from "@/tests/helpers/transactionalPhotoUploadQueueDatabase";

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
    uploadSlotOwner: null,
    uploadSlotExpiresAt: null,
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

function deferred<T = void>(): {
  promise: Promise<T>;
  resolve(value: T): void;
} {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

class ControllableRecoveryStore extends MemoryPhotoUploadQueueStore {
  recoveryFailure: Error | null = null;

  override async recoverInterrupted(
    scope: PhotoUploadScope,
    now: number,
    maxAttempts?: number
  ): Promise<number> {
    if (this.recoveryFailure) throw this.recoveryFailure;
    return super.recoverInterrupted(scope, now, maxAttempts);
  }
}

async function flushUnhandledRejections(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
  await new Promise<void>((resolve) => setImmediate(resolve));
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
          getConfirmation: async () => undefined,
          listConfirmationsByScope: async () => [],
          putConfirmation: async () => undefined,
          deleteConfirmation: async () => undefined,
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
      PHOTO_UPLOAD_QUEUE_DB_VERSION,
      expect.objectContaining({ onBlocking: expect.any(Function) })
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

    await expect(store.recoverInterrupted(SCOPE, 2_000, 2)).resolves.toBe(1);
    await expect(store.get("queue-1", SCOPE)).resolves.toMatchObject({
      status: "queued",
      attemptCount: 1,
      retryAt: null,
      updatedAt: 2_000,
    });
  });

  it("marks exhausted interrupted uploads failed", async () => {
    const store = new MemoryPhotoUploadQueueStore(createMemoryPhotoUploadQueueDatabase());
    await store.put(
      SCOPE,
      queuedPhoto({
        status: "uploading",
        attemptCount: 2,
        updatedAt: 1_100,
      })
    );

    await expect(store.recoverInterrupted(SCOPE, 2_000, 2)).resolves.toBe(1);
    await expect(store.get("queue-1", SCOPE)).resolves.toMatchObject({
      status: "failed",
      attemptCount: 2,
      retryAt: null,
      lastError: PHOTO_UPLOAD_MAX_ATTEMPTS_ERROR,
      updatedAt: 2_000,
      leaseOwner: null,
      uploadSlotOwner: null,
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

describe("IndexedDbPhotoUploadQueueStore adapter", () => {
  it("consumes transaction completion rejection after a request rejects", async () => {
    const requestError = new DOMException("Request failed.", "UnknownError");
    const completionError = new DOMException("Transaction aborted.", "AbortError");
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => {
      if (reason === completionError) unhandled.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);

    try {
      const store = new IndexedDbPhotoUploadQueueStore({
        openDatabase: async () => ({
          transaction: () => ({
            get: async () => {
              throw requestError;
            },
            listByScope: async () => [],
            put: async () => undefined,
            delete: async () => undefined,
            getConfirmation: async () => undefined,
            listConfirmationsByScope: async () => [],
            putConfirmation: async () => undefined,
            deleteConfirmation: async () => undefined,
            done: Promise.reject(completionError),
          }),
        }),
      });

      const failure = await store.get("queue-1", SCOPE).catch((error) => error);
      expect(failure).toBeInstanceOf(PhotoQueuePersistenceError);
      expect(failure).toMatchObject({ code: "persistence_failed" });
      expect((failure as Error).cause).toBe(requestError);

      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  it("scopes mutation and resolves only after its transaction commits", async () => {
    const database = createTransactionalPhotoUploadQueueDatabase();
    const store = new IndexedDbPhotoUploadQueueStore({
      openDatabase: database.openDatabase,
    });
    const otherScope = { ...SCOPE, locationId: "location-b" };
    await store.put(SCOPE, queuedPhoto());
    await store.put(
      otherScope,
      queuedPhoto({
        queueId: "other-queue",
        clientUploadId: "other-client",
        locationId: otherScope.locationId,
      })
    );

    await expect(
      store.update("other-queue", SCOPE, { status: "failed" })
    ).resolves.toBeNull();
    const gate = database.pauseNextCommit();
    let updateSettled = false;
    const update = store
      .update("queue-1", SCOPE, {
        status: "uploading",
        attemptCount: 1,
      })
      .then((item) => {
        updateSettled = true;
        return item;
      });
    await gate.started;

    expect(updateSettled).toBe(false);
    expect(
      database.committedItems().find((item) => item.queueId === "queue-1")
    ).toMatchObject({ status: "queued", attemptCount: 0 });

    gate.release();
    await expect(update).resolves.toMatchObject({
      status: "uploading",
      attemptCount: 1,
    });
    await expect(store.get("other-queue", otherScope)).resolves.toMatchObject({
      status: "queued",
    });
  });

  it("recovers only interrupted entries whose persisted claims expired", async () => {
    const database = createTransactionalPhotoUploadQueueDatabase();
    const store = new IndexedDbPhotoUploadQueueStore({
      openDatabase: database.openDatabase,
    });
    await store.put(
      SCOPE,
      queuedPhoto({
        queueId: "expired",
        status: "uploading",
        leaseOwner: "closed-tab",
        leaseExpiresAt: 1_500,
        uploadSlotOwner: "closed-tab",
        uploadSlotExpiresAt: 1_500,
      })
    );
    await store.put(
      SCOPE,
      queuedPhoto({
        queueId: "live",
        clientUploadId: "live-client",
        status: "uploading",
        leaseOwner: "live-tab",
        leaseExpiresAt: 3_000,
        uploadSlotOwner: "live-tab",
        uploadSlotExpiresAt: 3_000,
      })
    );
    await store.put(
      SCOPE,
      queuedPhoto({
        queueId: "slot-expired",
        clientUploadId: "slot-expired-client",
        status: "uploading",
        leaseOwner: "partial-tab",
        leaseExpiresAt: 3_000,
        uploadSlotOwner: "partial-tab",
        uploadSlotExpiresAt: 1_500,
      })
    );

    await expect(store.recoverInterrupted(SCOPE, 2_000)).resolves.toBe(2);
    await expect(store.get("expired", SCOPE)).resolves.toMatchObject({
      status: "queued",
      leaseOwner: null,
      uploadSlotOwner: null,
    });
    await expect(store.get("live", SCOPE)).resolves.toMatchObject({
      status: "uploading",
      leaseOwner: "live-tab",
      uploadSlotOwner: "live-tab",
    });
    await expect(store.get("slot-expired", SCOPE)).resolves.toMatchObject({
      status: "queued",
      leaseOwner: null,
      uploadSlotOwner: null,
    });
  });

  it("marks exhausted expired claims failed and requeues eligible claims", async () => {
    const database = createTransactionalPhotoUploadQueueDatabase();
    const store = new IndexedDbPhotoUploadQueueStore({
      openDatabase: database.openDatabase,
    });
    await store.put(
      SCOPE,
      queuedPhoto({
        queueId: "exhausted-expired",
        status: "uploading",
        attemptCount: 2,
        leaseOwner: "closed-tab",
        leaseExpiresAt: 1_500,
        uploadSlotOwner: "closed-tab",
        uploadSlotExpiresAt: 1_500,
      })
    );
    await store.put(
      SCOPE,
      queuedPhoto({
        queueId: "eligible-expired",
        clientUploadId: "eligible-expired-client",
        status: "uploading",
        attemptCount: 1,
        leaseOwner: "closed-tab",
        leaseExpiresAt: 1_500,
        uploadSlotOwner: "closed-tab",
        uploadSlotExpiresAt: 1_500,
      })
    );

    await expect(store.recoverInterrupted(SCOPE, 2_000, 2)).resolves.toBe(2);
    await expect(store.get("exhausted-expired", SCOPE)).resolves.toMatchObject({
      status: "failed",
      attemptCount: 2,
      retryAt: null,
      lastError: PHOTO_UPLOAD_MAX_ATTEMPTS_ERROR,
      leaseOwner: null,
      uploadSlotOwner: null,
    });
    await expect(store.get("eligible-expired", SCOPE)).resolves.toMatchObject({
      status: "queued",
      attemptCount: 1,
      retryAt: null,
      leaseOwner: null,
      uploadSlotOwner: null,
    });
  });

  it("requeues a released claim without recording a failed outcome", async () => {
    const database = createTransactionalPhotoUploadQueueDatabase();
    const store = new IndexedDbPhotoUploadQueueStore({
      openDatabase: database.openDatabase,
    });
    await store.put(SCOPE, queuedPhoto());
    await expect(
      store.tryAcquireUploadClaim("queue-1", SCOPE, "runner-a", 2_000, 1_000, 2, 1)
    ).resolves.toMatchObject({
      item: { status: "uploading", attemptCount: 0 },
    });

    await expect(
      store.releaseUploadClaim("queue-1", SCOPE, "runner-a", 2_100, 1)
    ).resolves.toBe(true);
    await expect(store.get("queue-1", SCOPE)).resolves.toMatchObject({
      status: "queued",
      attemptCount: 0,
      retryAt: null,
      lastError: null,
      leaseOwner: null,
      uploadSlotOwner: null,
    });
  });

  it("atomically reserves two scope-wide slots and waits for claim commit", async () => {
    const database = createTransactionalPhotoUploadQueueDatabase();
    const store = new IndexedDbPhotoUploadQueueStore({
      openDatabase: database.openDatabase,
    });
    for (let index = 1; index <= 3; index += 1) {
      await store.put(
        SCOPE,
        queuedPhoto({
          queueId: `claim-${index}`,
          clientUploadId: `claim-client-${index}`,
        })
      );
    }

    const gate = database.pauseNextCommit();
    let firstClaimSettled = false;
    const firstClaim = store
      .tryAcquireUploadClaim("claim-1", SCOPE, "runner-a", 2_000, 1_000, 2, 5)
      .then((claimed) => {
        firstClaimSettled = true;
        return claimed;
      });
    await gate.started;
    expect(firstClaimSettled).toBe(false);
    expect(
      database.committedItems().filter((item) => item.uploadSlotOwner !== null)
    ).toHaveLength(0);
    gate.release();
    await expect(firstClaim).resolves.toMatchObject({
      expiresAt: 3_000,
      item: { status: "uploading", attemptCount: 0 },
    });

    const remainingClaims = await Promise.all([
      store.tryAcquireUploadClaim("claim-2", SCOPE, "runner-b", 2_000, 1_000, 2, 5),
      store.tryAcquireUploadClaim("claim-3", SCOPE, "runner-c", 2_000, 1_000, 2, 5),
    ]);
    expect(remainingClaims.filter((claim) => claim !== null)).toHaveLength(1);
    expect(
      database
        .committedItems()
        .filter(
          (item) => item.uploadSlotOwner !== null && item.uploadSlotExpiresAt! > 2_000
        )
    ).toHaveLength(2);
  });

  it("atomically enforces retry timing and attempt limits when claiming", async () => {
    const database = createTransactionalPhotoUploadQueueDatabase();
    const store = new IndexedDbPhotoUploadQueueStore({
      openDatabase: database.openDatabase,
    });
    await store.put(
      SCOPE,
      queuedPhoto({
        queueId: "retrying",
        clientUploadId: "retrying-client",
        status: "retry_wait",
        attemptCount: 1,
        retryAt: 3_000,
      })
    );
    await store.put(
      SCOPE,
      queuedPhoto({
        queueId: "exhausted",
        clientUploadId: "exhausted-client",
        attemptCount: 2,
      })
    );

    await expect(
      store.tryAcquireUploadClaim("retrying", SCOPE, "runner-a", 2_999, 1_000, 2, 5)
    ).resolves.toBeNull();
    await expect(store.get("retrying", SCOPE)).resolves.toMatchObject({
      status: "retry_wait",
      attemptCount: 1,
      retryAt: 3_000,
    });

    await expect(
      store.tryAcquireUploadClaim("retrying", SCOPE, "runner-a", 3_000, 1_000, 2, 5)
    ).resolves.toMatchObject({
      expiresAt: 4_000,
      item: {
        status: "uploading",
        attemptCount: 1,
        retryAt: null,
        leaseOwner: "runner-a",
      },
    });
    await expect(store.get("retrying", SCOPE)).resolves.toMatchObject({
      status: "uploading",
      attemptCount: 1,
      retryAt: null,
    });

    await expect(
      store.tryAcquireUploadClaim("exhausted", SCOPE, "runner-b", 3_000, 1_000, 2, 2)
    ).resolves.toBeNull();
    await expect(store.get("exhausted", SCOPE)).resolves.toMatchObject({
      status: "queued",
      attemptCount: 2,
      leaseOwner: null,
    });
  });

  it("failed outcome invariant: does not count a claim recovered after tab termination", async () => {
    const database = createTransactionalPhotoUploadQueueDatabase();
    const store = new IndexedDbPhotoUploadQueueStore({
      openDatabase: database.openDatabase,
    });
    await store.put(SCOPE, queuedPhoto({ attemptCount: 1 }));

    await expect(
      store.tryAcquireUploadClaim("queue-1", SCOPE, "closed-tab", 2_000, 1_000, 2, 3)
    ).resolves.toMatchObject({
      expiresAt: 3_000,
      item: {
        status: "uploading",
        attemptCount: 1,
        leaseOwner: "closed-tab",
      },
    });

    await expect(store.recoverInterrupted(SCOPE, 3_000, 3)).resolves.toBe(1);
    await expect(store.get("queue-1", SCOPE)).resolves.toMatchObject({
      status: "queued",
      attemptCount: 1,
      leaseOwner: null,
      uploadSlotOwner: null,
    });
    await expect(
      store.tryAcquireUploadClaim("queue-1", SCOPE, "reopened-tab", 3_000, 1_000, 2, 3)
    ).resolves.toMatchObject({
      item: {
        status: "uploading",
        attemptCount: 1,
        leaseOwner: "reopened-tab",
      },
    });
  });

  it("failed outcome invariant: atomically counts outcomes and advances backoff", async () => {
    const database = createTransactionalPhotoUploadQueueDatabase();
    const store = new IndexedDbPhotoUploadQueueStore({
      openDatabase: database.openDatabase,
    });
    await store.put(SCOPE, queuedPhoto());
    const failure = {
      ok: false as const,
      retryable: true,
      message: "Network unavailable",
    };
    const policy = {
      maxAttempts: 4,
      baseRetryDelayMs: 1_000,
      maxRetryDelayMs: 10_000,
    };

    await store.tryAcquireUploadClaim(
      "queue-1",
      SCOPE,
      "runner-a",
      2_000,
      1_000,
      2,
      policy.maxAttempts
    );
    await expect(
      store.settleClaimedFailure("queue-1", SCOPE, "runner-a", 2_000, failure, policy)
    ).resolves.toMatchObject({
      status: "retry_wait",
      attemptCount: 1,
      retryAt: 3_000,
      lastError: failure.message,
    });

    await store.tryAcquireUploadClaim(
      "queue-1",
      SCOPE,
      "runner-a",
      3_000,
      1_000,
      2,
      policy.maxAttempts
    );
    await expect(
      store.settleClaimedFailure("queue-1", SCOPE, "runner-a", 3_000, failure, policy)
    ).resolves.toMatchObject({
      status: "retry_wait",
      attemptCount: 2,
      retryAt: 5_000,
    });

    await store.tryAcquireUploadClaim(
      "queue-1",
      SCOPE,
      "runner-a",
      5_000,
      1_000,
      2,
      policy.maxAttempts
    );
    await expect(
      store.settleClaimedFailure("queue-1", SCOPE, "runner-a", 5_000, failure, policy)
    ).resolves.toMatchObject({
      status: "retry_wait",
      attemptCount: 3,
      retryAt: 9_000,
    });

    await store.tryAcquireUploadClaim(
      "queue-1",
      SCOPE,
      "runner-a",
      9_000,
      1_000,
      2,
      policy.maxAttempts
    );
    await expect(
      store.settleClaimedFailure("queue-1", SCOPE, "runner-a", 9_000, failure, policy)
    ).resolves.toMatchObject({
      status: "failed",
      attemptCount: 4,
      retryAt: null,
      lastError: failure.message,
      leaseOwner: null,
      uploadSlotOwner: null,
    });
  });

  it("restores prior eligibility when releasing an unstarted attempt", async () => {
    const database = createTransactionalPhotoUploadQueueDatabase();
    const store = new IndexedDbPhotoUploadQueueStore({
      openDatabase: database.openDatabase,
    });
    await store.put(
      SCOPE,
      queuedPhoto({
        status: "retry_wait",
        attemptCount: 1,
        retryAt: 2_000,
        lastError: "Previous network failure",
      })
    );
    const claim = await store.tryAcquireUploadClaim(
      "queue-1",
      SCOPE,
      "runner-a",
      2_000,
      1_000,
      2,
      2
    );
    expect(claim).toMatchObject({
      item: { status: "uploading", attemptCount: 1 },
    });

    await expect(
      store.releaseUnstartedUploadClaim("queue-1", SCOPE, "runner-b", 2_100, claim!)
    ).resolves.toBe(false);
    await expect(
      store.releaseUnstartedUploadClaim("queue-1", SCOPE, "runner-a", 2_100, claim!)
    ).resolves.toBe(true);
    await expect(store.get("queue-1", SCOPE)).resolves.toMatchObject({
      status: "retry_wait",
      attemptCount: 1,
      retryAt: 2_000,
      lastError: "Previous network failure",
      updatedAt: 2_100,
      leaseOwner: null,
      uploadSlotOwner: null,
    });
  });

  it("owner-fences failed-outcome counting and releases its claim", async () => {
    const database = createTransactionalPhotoUploadQueueDatabase();
    const store = new IndexedDbPhotoUploadQueueStore({
      openDatabase: database.openDatabase,
    });
    await store.put(SCOPE, queuedPhoto());
    await store.tryAcquireUploadClaim("queue-1", SCOPE, "runner-a", 2_000, 1_000, 2, 5);
    const failure = {
      ok: false as const,
      retryable: true,
      message: "Network unavailable",
    };
    const policy = {
      maxAttempts: 5,
      baseRetryDelayMs: 1_000,
      maxRetryDelayMs: 60_000,
    };

    await expect(
      store.settleClaimedFailure("queue-1", SCOPE, "runner-b", 2_100, failure, policy)
    ).resolves.toBeNull();
    await expect(
      store.settleClaimedFailure("queue-1", SCOPE, "runner-a", 2_100, failure, policy)
    ).resolves.toMatchObject({
      status: "retry_wait",
      attemptCount: 1,
      retryAt: 3_100,
      lastError: "Network unavailable",
      leaseOwner: null,
      uploadSlotOwner: null,
    });
  });

  it("fences claimed mutation and completion by persisted owner", async () => {
    const database = createTransactionalPhotoUploadQueueDatabase();
    const store = new IndexedDbPhotoUploadQueueStore({
      openDatabase: database.openDatabase,
    });
    await store.put(SCOPE, queuedPhoto());
    await expect(
      store.tryAcquireUploadClaim("queue-1", SCOPE, "runner-a", 2_000, 1_000, 2, 5)
    ).resolves.toMatchObject({
      expiresAt: 3_000,
      item: { status: "uploading", attemptCount: 0 },
    });

    await expect(
      store.updateClaimed("queue-1", SCOPE, "runner-b", 2_100, {
        status: "uploading",
      })
    ).resolves.toBeNull();
    await expect(
      store.completeClaimedUpload("queue-1", SCOPE, "runner-b", 2_100, {
        photoId: "photo-1",
        clientUploadId: "client-upload-1",
      })
    ).resolves.toBe(false);
    await expect(store.get("queue-1", SCOPE)).resolves.toMatchObject({
      status: "uploading",
      attemptCount: 0,
      leaseOwner: "runner-a",
      uploadSlotOwner: "runner-a",
    });

    await expect(
      store.updateClaimed("queue-1", SCOPE, "runner-a", 2_100, {
        status: "uploading",
      })
    ).resolves.toMatchObject({ status: "uploading" });
    await expect(
      store.completeClaimedUpload("queue-1", SCOPE, "runner-a", 2_100, {
        photoId: "photo-1",
        clientUploadId: "client-upload-1",
      })
    ).resolves.toBe(true);
    await expect(store.get("queue-1", SCOPE)).resolves.toBeNull();
    const receipts = await store.listConfirmations(SCOPE);
    expect(receipts).toEqual([
      expect.objectContaining({
        queueId: "queue-1",
        clientUploadId: "client-upload-1",
        photoId: "photo-1",
        userId: SCOPE.userId,
        locationId: SCOPE.locationId,
        confirmedAt: 2_100,
        category: "damage",
        workOrderId: "work-order-1",
      }),
    ]);
    expect(receipts[0]).not.toHaveProperty("blob");
  });

  it("hydrates scoped confirmation receipts without photo bytes after remount", async () => {
    const shared = createMemoryPhotoUploadQueueDatabase();
    const first = new MemoryPhotoUploadQueueStore(shared);
    await first.put(
      SCOPE,
      queuedPhoto({
        status: "uploading",
        leaseOwner: "runner-a",
        leaseExpiresAt: 3_000,
        uploadSlotOwner: "runner-a",
        uploadSlotExpiresAt: 3_000,
      })
    );
    await expect(
      first.completeClaimedUpload("queue-1", SCOPE, "runner-a", 2_100, {
        photoId: "photo-1",
        clientUploadId: "client-upload-1",
      })
    ).resolves.toBe(true);

    const remounted = new MemoryPhotoUploadQueueStore(shared);
    await expect(remounted.get("queue-1", SCOPE)).resolves.toBeNull();
    await expect(remounted.getConfirmation("queue-1", SCOPE)).resolves.toMatchObject({
      photoId: "photo-1",
      clientUploadId: "client-upload-1",
    });
    await expect(
      remounted.listConfirmations({ userId: "user-b", locationId: SCOPE.locationId })
    ).resolves.toEqual([]);
  });

  it("prunes old scoped confirmation receipts while keeping needed and in-scope fresh ones", async () => {
    const database = createMemoryPhotoUploadQueueDatabase();
    const store = new MemoryPhotoUploadQueueStore(database);
    const now = 2_000_000_000_000;
    const oldAt = now - PHOTO_CONFIRMATION_TTL_MS - 1;
    await store.put(SCOPE, queuedPhoto({ queueId: "live-item" }));
    database.confirmations.set("old", {
      queueId: "old",
      clientUploadId: "c-old",
      photoId: "p-old",
      userId: SCOPE.userId,
      locationId: SCOPE.locationId,
      confirmedAt: oldAt,
      category: "front",
    });
    database.confirmations.set("fresh", {
      queueId: "fresh",
      clientUploadId: "c-fresh",
      photoId: "p-fresh",
      userId: SCOPE.userId,
      locationId: SCOPE.locationId,
      confirmedAt: now - 10,
      category: "rear",
    });
    database.confirmations.set("kept-wait", {
      queueId: "kept-wait",
      clientUploadId: "c-wait",
      photoId: "p-wait",
      userId: SCOPE.userId,
      locationId: SCOPE.locationId,
      confirmedAt: oldAt,
      category: "vin",
    });
    database.confirmations.set("live-item", {
      queueId: "live-item",
      clientUploadId: "c-live",
      photoId: "p-live",
      userId: SCOPE.userId,
      locationId: SCOPE.locationId,
      confirmedAt: oldAt,
      category: "damage",
    });
    database.confirmations.set("other-scope", {
      queueId: "other-scope",
      clientUploadId: "c-b",
      photoId: "p-b",
      userId: "user-b",
      locationId: SCOPE.locationId,
      confirmedAt: oldAt,
      category: "front",
    });

    await expect(
      store.pruneConfirmations(
        SCOPE,
        now - PHOTO_CONFIRMATION_TTL_MS,
        new Set(["kept-wait"])
      )
    ).resolves.toBe(1);
    const remaining = await store.listConfirmations(SCOPE);
    expect(remaining.map((receipt) => receipt.queueId).sort()).toEqual([
      "fresh",
      "kept-wait",
      "live-item",
    ]);
    await expect(
      store.listConfirmations({ userId: "user-b", locationId: SCOPE.locationId })
    ).resolves.toEqual([expect.objectContaining({ queueId: "other-scope" })]);
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
    await vi.waitFor(async () => {
      expect(await store.get("queue-1", SCOPE)).toBeNull();
    });
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

  it("failed outcome invariant: replays a crash after uploader invocation before settlement", async () => {
    class NoRenewalStore extends MemoryPhotoUploadQueueStore {
      override async renewUploadClaim(): Promise<PhotoUploadClaim | null> {
        return null;
      }
    }
    const store = new NoRenewalStore(createMemoryPhotoUploadQueueDatabase());
    await store.put(SCOPE, queuedPhoto({ attemptCount: 1 }));
    const timer = new ManualClockTimer();
    const interruptedUpload = deferred<{ ok: true; photoId: string }>();
    const replayedUpload = deferred<{ ok: true; photoId: string }>();
    let interruptedSignal: AbortSignal | undefined;
    const uploader = vi
      .fn()
      .mockImplementationOnce((_item: QueuedPhotoUpload, signal: AbortSignal) => {
        interruptedSignal = signal;
        return interruptedUpload.promise;
      })
      .mockImplementationOnce(() => replayedUpload.promise);
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
      leaseTtlMs: 1_000,
      maxAttempts: 2,
    });

    const running = runner.start();
    try {
      await vi.waitFor(() => expect(uploader).toHaveBeenCalledTimes(1));
      expect(uploader.mock.calls[0]?.[0]).toMatchObject({
        status: "uploading",
        attemptCount: 1,
      });

      timer.advanceBy(500);
      await vi.waitFor(() => expect(interruptedSignal?.aborted).toBe(true));
      timer.advanceBy(500);

      await vi.waitFor(() => expect(uploader).toHaveBeenCalledTimes(2));
      expect(uploader.mock.calls[1]?.[0]).toMatchObject({
        status: "uploading",
        attemptCount: 1,
      });
      await expect(store.get("queue-1", SCOPE)).resolves.toMatchObject({
        status: "uploading",
        attemptCount: 1,
      });

      replayedUpload.resolve({ ok: true, photoId: "replayed-photo" });
      await vi.waitFor(async () => {
        expect(await store.get("queue-1", SCOPE)).toBeNull();
      });
    } finally {
      interruptedUpload.resolve({ ok: true, photoId: "interrupted-photo" });
      replayedUpload.resolve({ ok: true, photoId: "replayed-photo" });
      await runner.stop();
      await running;
    }
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

  it.each([
    {
      label: "permanent",
      outcome: {
        ok: false as const,
        retryable: false,
        message: "This photo type is not supported.",
      },
      expectedStatus: "failed" as const,
      expectedRetryAt: null,
    },
    {
      label: "retryable",
      outcome: {
        ok: false as const,
        retryable: true,
        message: "Network unavailable",
      },
      expectedStatus: "retry_wait" as const,
      expectedRetryAt: 3_000,
    },
  ])(
    "fallback settlement persists a known $label outcome after the primary write fails",
    async ({ outcome, expectedStatus, expectedRetryAt }) => {
      const primaryError = new PhotoQueuePersistenceError(
        "persistence_failed",
        "The primary settlement write failed."
      );
      class PrimaryFailureStore extends MemoryPhotoUploadQueueStore {
        primaryCalls = 0;
        fallbackCalls = 0;

        override async settleClaimedFailure(
          queueId: string,
          scope: PhotoUploadScope,
          owner: string,
          now: number,
          failure: PhotoUploadFailureOutcome,
          policy: PhotoUploadRetryPolicy
        ): Promise<QueuedPhotoUpload | null> {
          if (this.primaryCalls === 0) {
            this.primaryCalls += 1;
            throw primaryError;
          }
          this.fallbackCalls += 1;
          return super.settleClaimedFailure(queueId, scope, owner, now, failure, policy);
        }
      }
      const store = new PrimaryFailureStore(createMemoryPhotoUploadQueueDatabase());
      await store.put(SCOPE, queuedPhoto());
      const timer = new ManualClockTimer();
      const uploader = vi.fn().mockResolvedValue(outcome);
      const onError = vi.fn();
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
        onError,
      });

      await runner.start();
      await vi.waitFor(async () => {
        expect(await store.get("queue-1", SCOPE)).toMatchObject({
          status: expectedStatus,
          attemptCount: 1,
          retryAt: expectedRetryAt,
          lastError: outcome.message,
          leaseOwner: null,
          uploadSlotOwner: null,
        });
      });
      expect(store.primaryCalls).toBe(1);
      expect(store.fallbackCalls).toBe(1);
      expect(onError).not.toHaveBeenCalled();
      expect(uploader).toHaveBeenCalledTimes(1);
      if (expectedStatus === "retry_wait") {
        await vi.waitFor(() => expect(timer.nextDelay).toBe(1_000));
        await Promise.resolve();
        expect(uploader).toHaveBeenCalledTimes(1);
      } else {
        await vi.waitFor(() => expect(timer.nextDelay).toBeNull());
      }
      await runner.stop();
    }
  );

  it("surfaces fallback settlement failure and schedules bounded recovery", async () => {
    const primaryError = new PhotoQueuePersistenceError(
      "persistence_failed",
      "The primary settlement write failed."
    );
    const fallbackError = new PhotoQueuePersistenceError(
      "persistence_failed",
      "The fallback settlement write failed."
    );
    class FailingSettlementStore extends MemoryPhotoUploadQueueStore {
      settlementCalls = 0;

      override async settleClaimedFailure(): Promise<QueuedPhotoUpload | null> {
        this.settlementCalls += 1;
        if (this.settlementCalls === 1) throw primaryError;
        throw fallbackError;
      }
    }
    const store = new FailingSettlementStore(createMemoryPhotoUploadQueueDatabase());
    await store.put(SCOPE, queuedPhoto());
    const timer = new ManualClockTimer();
    const uploader = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        retryable: false,
        message: "This photo type is not supported.",
      })
      .mockResolvedValueOnce({ ok: true, photoId: "replayed-photo" });
    const onError = vi.fn();
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);
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
      leaseTtlMs: 1_000,
      maxAttempts: 1,
      onError,
    });

    try {
      await runner.start();
      await vi.waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
      expect(onError.mock.calls[0]?.[0]).toMatchObject({
        name: "PhotoUploadQueueRunnerError",
        source: "upload_settlement",
        cause: fallbackError,
      });
      expect(unhandled).toEqual([]);
      expect(uploader).toHaveBeenCalledTimes(1);
      await expect(store.get("queue-1", SCOPE)).resolves.toMatchObject({
        status: "uploading",
        attemptCount: 0,
      });
      expect(timer.nextDelay).toBe(1_000);

      timer.advanceBy(1_000);
      await vi.waitFor(async () => {
        expect(await store.get("queue-1", SCOPE)).toBeNull();
      });
      expect(uploader).toHaveBeenCalledTimes(2);
      expect(store.settlementCalls).toBe(2);
      await flushUnhandledRejections();
      expect(unhandled).toEqual([]);
    } finally {
      await runner.stop();
      process.off("unhandledRejection", onUnhandled);
    }
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

  it.each(["online", "pageshow", "visibilitychange"] as const)(
    "surfaces a rejecting %s event wake without an unhandled rejection",
    async (source) => {
      const store = new ControllableRecoveryStore(createMemoryPhotoUploadQueueDatabase());
      const timer = new ManualClockTimer();
      const events = new EventTarget();
      const failure = new PhotoQueuePersistenceError(
        "persistence_failed",
        "IndexedDB became unavailable."
      );
      const onError = vi.fn();
      const unhandled: unknown[] = [];
      const onUnhandled = (reason: unknown): void => {
        unhandled.push(reason);
      };
      process.on("unhandledRejection", onUnhandled);
      const runner = new PhotoUploadQueueRunner({
        scope: SCOPE,
        store,
        uploader: vi.fn(),
        now: () => timer.now,
        timer,
        isOnline: () => true,
        isVisible: () => true,
        eventTarget: events,
        ownerId: "runner-a",
        onError,
      });

      try {
        await runner.start();
        store.recoveryFailure = failure;
        events.dispatchEvent(new Event(source));
        await flushUnhandledRejections();

        expect(onError).toHaveBeenCalledTimes(1);
        const reported = onError.mock.calls[0]?.[0];
        expect(reported).toBeInstanceOf(PhotoUploadQueueRunnerError);
        expect(reported).toMatchObject({
          name: "PhotoUploadQueueRunnerError",
          source,
        });
        expect((reported as Error).cause).toBe(failure);
        expect(unhandled).toEqual([]);
      } finally {
        await runner.stop();
        process.off("unhandledRejection", onUnhandled);
      }
    }
  );

  it("surfaces a rejecting retry timer wake without an unhandled rejection", async () => {
    const store = new ControllableRecoveryStore(createMemoryPhotoUploadQueueDatabase());
    await store.put(
      SCOPE,
      queuedPhoto({
        status: "retry_wait",
        attemptCount: 1,
        retryAt: 3_000,
      })
    );
    const timer = new ManualClockTimer();
    const failure = new PhotoQueuePersistenceError(
      "persistence_failed",
      "IndexedDB became unavailable."
    );
    const onError = vi.fn();
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);
    const runner = new PhotoUploadQueueRunner({
      scope: SCOPE,
      store,
      uploader: vi.fn(),
      now: () => timer.now,
      timer,
      isOnline: () => true,
      isVisible: () => true,
      eventTarget: new EventTarget(),
      ownerId: "runner-a",
      onError,
    });

    try {
      await runner.start();
      expect(timer.nextDelay).toBe(1_000);
      store.recoveryFailure = failure;
      timer.advanceBy(1_000);
      await flushUnhandledRejections();

      expect(onError).toHaveBeenCalledTimes(1);
      const reported = onError.mock.calls[0]?.[0];
      expect(reported).toBeInstanceOf(PhotoUploadQueueRunnerError);
      expect(reported).toMatchObject({
        name: "PhotoUploadQueueRunnerError",
        source: "retry_timer",
      });
      expect((reported as Error).cause).toBe(failure);
      expect(unhandled).toEqual([]);
    } finally {
      await runner.stop();
      process.off("unhandledRejection", onUnhandled);
    }
  });

  it("deadline crossing: immediately repumps when retryAt becomes due during final scheduling", async () => {
    const timer = new ManualClockTimer();
    class RetryDeadlineCrossingStore extends MemoryPhotoUploadQueueStore {
      listCalls = 0;

      override async list(scope: PhotoUploadScope): Promise<QueuedPhotoUpload[]> {
        const items = await super.list(scope);
        this.listCalls += 1;
        if (this.listCalls === 2) timer.now = 3_001;
        return items;
      }
    }
    const store = new RetryDeadlineCrossingStore(createMemoryPhotoUploadQueueDatabase());
    await store.put(
      SCOPE,
      queuedPhoto({
        status: "retry_wait",
        attemptCount: 1,
        retryAt: 3_000,
      })
    );
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
      ownerId: "runner-a",
    });

    await runner.start();
    await vi.waitFor(() => expect(uploader).toHaveBeenCalledTimes(1));
    await vi.waitFor(async () => {
      expect(await store.get("queue-1", SCOPE)).toBeNull();
    });
    expect(timer.now).toBe(3_001);
    await runner.stop();
  });

  it("deadline crossing: immediately recovers a claim expiring after initial recovery", async () => {
    const timer = new ManualClockTimer();
    class ClaimDeadlineCrossingStore extends MemoryPhotoUploadQueueStore {
      listCalls = 0;
      recoveredItems = 0;

      override async list(scope: PhotoUploadScope): Promise<QueuedPhotoUpload[]> {
        const items = await super.list(scope);
        this.listCalls += 1;
        if (this.listCalls === 2) timer.now = 3_001;
        return items;
      }

      override async recoverInterrupted(
        scope: PhotoUploadScope,
        now: number,
        maxAttempts?: number
      ): Promise<number> {
        const recovered = await super.recoverInterrupted(scope, now, maxAttempts);
        this.recoveredItems += recovered;
        return recovered;
      }
    }
    const store = new ClaimDeadlineCrossingStore(createMemoryPhotoUploadQueueDatabase());
    await store.put(
      SCOPE,
      queuedPhoto({
        status: "uploading",
        leaseOwner: "closed-tab",
        leaseExpiresAt: 3_000,
        uploadSlotOwner: "closed-tab",
        uploadSlotExpiresAt: 3_000,
      })
    );
    const uploader = vi.fn().mockResolvedValue({
      ok: true,
      photoId: "recovered-photo",
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
    });

    await runner.start();
    await vi.waitFor(() => expect(store.recoveredItems).toBe(1));
    await vi.waitFor(() => expect(uploader).toHaveBeenCalledTimes(1));
    await vi.waitFor(async () => {
      expect(await store.get("queue-1", SCOPE)).toBeNull();
    });
    await runner.stop();
  });

  it("deadline crossing: live scope claims allow only one immediate repump", async () => {
    class CountingClaimStore extends MemoryPhotoUploadQueueStore {
      claimCalls = 0;

      override async tryAcquireUploadClaim(
        queueId: string,
        scope: PhotoUploadScope,
        owner: string,
        now: number,
        ttlMs: number,
        maxScopeSlots: number,
        maxAttempts: number
      ): Promise<AcquiredPhotoUploadClaim | null> {
        this.claimCalls += 1;
        return super.tryAcquireUploadClaim(
          queueId,
          scope,
          owner,
          now,
          ttlMs,
          maxScopeSlots,
          maxAttempts
        );
      }
    }
    const store = new CountingClaimStore(createMemoryPhotoUploadQueueDatabase());
    await store.put(
      SCOPE,
      queuedPhoto({
        queueId: "due-retry",
        status: "retry_wait",
        attemptCount: 1,
        retryAt: 1_500,
      })
    );
    for (const index of [1, 2]) {
      await store.put(
        SCOPE,
        queuedPhoto({
          queueId: `live-claim-${index}`,
          clientUploadId: `live-client-${index}`,
          status: "uploading",
          leaseOwner: `other-tab-${index}`,
          leaseExpiresAt: 5_000,
          uploadSlotOwner: `other-tab-${index}`,
          uploadSlotExpiresAt: 5_000,
        })
      );
    }
    const timer = new ManualClockTimer();
    const uploader = vi.fn();
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

    await runner.start();
    await Promise.resolve();
    await Promise.resolve();

    expect(store.claimCalls).toBe(2);
    expect(uploader).not.toHaveBeenCalled();
    expect(timer.nextDelay).toBe(3_000);
    await runner.stop();
  });

  it("rolls back unstarted attempts across repeated availability races", async () => {
    const gates = [
      { started: deferred(), release: deferred() },
      { started: deferred(), release: deferred() },
    ];
    class GatedClaimStore extends MemoryPhotoUploadQueueStore {
      claimCalls = 0;

      override async tryAcquireUploadClaim(
        queueId: string,
        scope: PhotoUploadScope,
        owner: string,
        now: number,
        ttlMs: number,
        maxScopeSlots: number,
        maxAttempts: number
      ): Promise<AcquiredPhotoUploadClaim | null> {
        const claim = await super.tryAcquireUploadClaim(
          queueId,
          scope,
          owner,
          now,
          ttlMs,
          maxScopeSlots,
          maxAttempts
        );
        const gate = gates[this.claimCalls];
        this.claimCalls += 1;
        if (gate && claim) {
          gate.started.resolve();
          await gate.release.promise;
        }
        return claim;
      }
    }
    const store = new GatedClaimStore(createMemoryPhotoUploadQueueDatabase());
    await store.put(
      SCOPE,
      queuedPhoto({
        attemptCount: 1,
        lastError: "Previous network failure",
      })
    );
    let visible = true;
    const uploader = vi.fn().mockResolvedValue({
      ok: true,
      photoId: "photo-1",
    });
    const runner = new PhotoUploadQueueRunner({
      scope: SCOPE,
      store,
      uploader,
      now: () => 2_000,
      timer: { setTimeout: () => 1, clearTimeout: () => undefined },
      isOnline: () => true,
      isVisible: () => visible,
      eventTarget: new EventTarget(),
      ownerId: "runner-a",
      maxAttempts: 2,
    });

    try {
      for (const [index, gate] of gates.entries()) {
        visible = true;
        const scheduling = index === 0 ? runner.start() : runner.wake();
        await gate.started.promise;
        visible = false;
        gate.release.resolve();
        await scheduling;

        await expect(store.get("queue-1", SCOPE)).resolves.toMatchObject({
          status: "queued",
          attemptCount: 1,
          lastError: "Previous network failure",
          leaseOwner: null,
          uploadSlotOwner: null,
        });
        expect(uploader).not.toHaveBeenCalled();
      }

      visible = true;
      await runner.wake();
      await vi.waitFor(() => expect(uploader).toHaveBeenCalledTimes(1));
      expect(uploader.mock.calls[0]?.[0]).toMatchObject({
        status: "uploading",
        attemptCount: 1,
      });
      await vi.waitFor(async () => {
        expect(await store.get("queue-1", SCOPE)).toBeNull();
      });
    } finally {
      for (const gate of gates) gate.release.resolve();
      await runner.stop();
    }
  });

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
    await vi.waitFor(async () => {
      expect(await store.list(SCOPE)).toEqual([]);
    });
    runner.stop();
  });

  it("limits concurrent uploads to two across multiple runners in one scope", async () => {
    const store = new MemoryPhotoUploadQueueStore(createMemoryPhotoUploadQueueDatabase());
    for (let index = 1; index <= 3; index += 1) {
      await store.put(
        SCOPE,
        queuedPhoto({
          queueId: `scope-queue-${index}`,
          clientUploadId: `scope-client-${index}`,
        })
      );
    }
    const timer = new ManualClockTimer();
    let activeUploads = 0;
    let maximumActiveUploads = 0;
    const releases: Array<() => void> = [];
    const uploader = vi.fn(
      (item: QueuedPhotoUpload) =>
        new Promise<{ ok: true; photoId: string }>((resolve) => {
          activeUploads += 1;
          maximumActiveUploads = Math.max(maximumActiveUploads, activeUploads);
          releases.push(() => {
            activeUploads -= 1;
            resolve({ ok: true, photoId: `photo-${item.queueId}` });
          });
        })
    );
    const runners = ["runner-a", "runner-b", "runner-c"].map(
      (ownerId) =>
        new PhotoUploadQueueRunner({
          scope: SCOPE,
          store,
          uploader,
          now: () => timer.now,
          timer,
          isOnline: () => true,
          isVisible: () => true,
          eventTarget: new EventTarget(),
          ownerId,
          leaseTtlMs: 10_000,
        })
    );

    const starts = runners.map((runner) => runner.start());
    await vi.waitFor(() => expect(uploader.mock.calls.length).toBeGreaterThanOrEqual(2));
    await Promise.resolve();
    await Promise.resolve();

    expect(maximumActiveUploads).toBe(2);

    releases.shift()?.();
    for (const runner of runners) void runner.wake();
    await vi.waitFor(() => expect(uploader).toHaveBeenCalledTimes(3));
    expect(maximumActiveUploads).toBe(2);

    for (const release of releases.splice(0)) release();
    await Promise.all(starts);
    await vi.waitFor(async () => {
      expect(await store.list(SCOPE)).toEqual([]);
    });
    for (const runner of runners) await runner.stop();
  });

  it("atomically rejects a stale snapshot after another runner schedules backoff", async () => {
    const staleListCaptured = deferred();
    const releaseStaleList = deferred();
    class StaleFirstListStore extends MemoryPhotoUploadQueueStore {
      private listCalls = 0;

      override async list(scope: PhotoUploadScope): Promise<QueuedPhotoUpload[]> {
        this.listCalls += 1;
        const snapshot = await super.list(scope);
        if (this.listCalls === 1) {
          staleListCaptured.resolve();
          await releaseStaleList.promise;
        }
        return snapshot;
      }
    }
    const store = new StaleFirstListStore(createMemoryPhotoUploadQueueDatabase());
    await store.put(SCOPE, queuedPhoto());
    const timer = new ManualClockTimer();
    const staleUploader = vi.fn().mockResolvedValue({
      ok: true,
      photoId: "stale-photo",
    });
    const retryingUploader = vi.fn().mockResolvedValue({
      ok: false,
      retryable: true,
      message: "Network unavailable",
    });
    const sharedOptions = {
      scope: SCOPE,
      store,
      now: () => timer.now,
      timer,
      isOnline: () => true,
      isVisible: () => true,
      eventTarget: new EventTarget(),
      baseRetryDelayMs: 1_000,
      maxAttempts: 5,
    };
    const staleRunner = new PhotoUploadQueueRunner({
      ...sharedOptions,
      uploader: staleUploader,
      ownerId: "stale-runner",
    });
    const retryingRunner = new PhotoUploadQueueRunner({
      ...sharedOptions,
      uploader: retryingUploader,
      ownerId: "retrying-runner",
    });

    const staleStart = staleRunner.start();
    await staleListCaptured.promise;
    await retryingRunner.start();
    timer.advanceBy(1_000);
    await retryingRunner.wake();
    await expect(store.get("queue-1", SCOPE)).resolves.toMatchObject({
      status: "retry_wait",
      attemptCount: 2,
      retryAt: 5_000,
    });

    releaseStaleList.resolve();
    await staleStart;

    expect(staleUploader).not.toHaveBeenCalled();
    await expect(store.get("queue-1", SCOPE)).resolves.toMatchObject({
      status: "retry_wait",
      attemptCount: 2,
      retryAt: 5_000,
    });
    await staleRunner.stop();
    await retryingRunner.stop();
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

  it("uses persisted expiry when acquisition resolves after a delay", async () => {
    const claimPersisted = deferred();
    const releaseAcquisition = deferred();
    const stalledRenewal = deferred<PhotoUploadClaim | null>();
    class DelayedAcquisitionStore extends MemoryPhotoUploadQueueStore {
      override async tryAcquireUploadClaim(
        queueId: string,
        scope: PhotoUploadScope,
        owner: string,
        now: number,
        ttlMs: number,
        maxScopeSlots: number,
        maxAttempts: number
      ): Promise<AcquiredPhotoUploadClaim | null> {
        const acquired = await super.tryAcquireUploadClaim(
          queueId,
          scope,
          owner,
          now,
          ttlMs,
          maxScopeSlots,
          maxAttempts
        );
        claimPersisted.resolve();
        await releaseAcquisition.promise;
        return acquired;
      }

      override async renewUploadClaim(): Promise<PhotoUploadClaim | null> {
        return stalledRenewal.promise;
      }
    }
    const store = new DelayedAcquisitionStore(createMemoryPhotoUploadQueueDatabase());
    await store.put(SCOPE, queuedPhoto());
    const timer = new ManualClockTimer();
    let finishUpload: () => void = () => {};
    let uploadSignal: AbortSignal | undefined;
    const uploader = vi.fn((_item: QueuedPhotoUpload, signal: AbortSignal) => {
      uploadSignal = signal;
      return new Promise<{ ok: true; photoId: string }>((resolve) => {
        finishUpload = () => resolve({ ok: true, photoId: "stale-photo" });
      });
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
      leaseTtlMs: 1_000,
    });

    const running = runner.start();
    await claimPersisted.promise;
    timer.advanceBy(500);
    releaseAcquisition.resolve();
    await vi.waitFor(() => expect(uploadSignal).toBeDefined());
    await expect(store.get("queue-1", SCOPE)).resolves.toMatchObject({
      leaseExpiresAt: 3_000,
      uploadSlotExpiresAt: 3_000,
    });

    timer.advanceBy(500);
    await vi.waitFor(() => expect(uploadSignal?.aborted).toBe(true));
    await vi.waitFor(async () => {
      expect(await store.get("queue-1", SCOPE)).toMatchObject({
        status: "queued",
      });
    });

    finishUpload();
    await runner.stop();
    await running;
    await expect(store.get("queue-1", SCOPE)).resolves.toMatchObject({
      status: "queued",
    });
  });

  it("immediately repumps once after releasing an expired acquisition", async () => {
    const firstClaimPersisted = deferred();
    const releaseFirstAcquisition = deferred();
    class FirstAcquisitionDelayStore extends MemoryPhotoUploadQueueStore {
      claimCalls = 0;

      override async tryAcquireUploadClaim(
        queueId: string,
        scope: PhotoUploadScope,
        owner: string,
        now: number,
        ttlMs: number,
        maxScopeSlots: number,
        maxAttempts: number
      ): Promise<AcquiredPhotoUploadClaim | null> {
        this.claimCalls += 1;
        const claim = await super.tryAcquireUploadClaim(
          queueId,
          scope,
          owner,
          now,
          ttlMs,
          maxScopeSlots,
          maxAttempts
        );
        if (this.claimCalls === 1) {
          firstClaimPersisted.resolve();
          await releaseFirstAcquisition.promise;
        }
        return claim;
      }
    }
    const store = new FirstAcquisitionDelayStore(createMemoryPhotoUploadQueueDatabase());
    await store.put(SCOPE, queuedPhoto());
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
      ownerId: "runner-a",
      leaseTtlMs: 1_000,
    });

    const running = runner.start();
    await firstClaimPersisted.promise;
    timer.advanceBy(1_001);
    releaseFirstAcquisition.resolve();
    await running;

    expect(store.claimCalls).toBe(2);
    expect(uploader).toHaveBeenCalledTimes(1);
    await expect(store.get("queue-1", SCOPE)).resolves.toBeNull();
    await runner.stop();
  });

  it("aborts at persisted expiry while renewal remains pending", async () => {
    const renewalStarted = deferred();
    const releaseRenewal = deferred();
    class StalledRenewalStore extends MemoryPhotoUploadQueueStore {
      override async renewUploadClaim(
        queueId: string,
        scope: PhotoUploadScope,
        owner: string,
        now: number,
        ttlMs: number
      ): Promise<PhotoUploadClaim | null> {
        renewalStarted.resolve();
        await releaseRenewal.promise;
        return super.renewUploadClaim(queueId, scope, owner, now, ttlMs);
      }
    }
    const store = new StalledRenewalStore(createMemoryPhotoUploadQueueDatabase());
    await store.put(SCOPE, queuedPhoto());
    const timer = new ManualClockTimer();
    let finishUpload: () => void = () => {};
    let uploadSignal: AbortSignal | undefined;
    const runner = new PhotoUploadQueueRunner({
      scope: SCOPE,
      store,
      uploader: (_item, signal) => {
        uploadSignal = signal;
        return new Promise<{ ok: true; photoId: string }>((resolve) => {
          finishUpload = () => resolve({ ok: true, photoId: "stale-photo" });
        });
      },
      now: () => timer.now,
      timer,
      isOnline: () => true,
      isVisible: () => true,
      eventTarget: new EventTarget(),
      ownerId: "runner-a",
      leaseTtlMs: 1_000,
    });

    const running = runner.start();
    await vi.waitFor(() => expect(uploadSignal).toBeDefined());
    timer.advanceBy(500);
    await renewalStarted.promise;

    timer.advanceBy(500);
    await vi.waitFor(() => expect(uploadSignal?.aborted).toBe(true));

    await expect(
      store.tryAcquireUploadClaim("queue-1", SCOPE, "runner-b", timer.now, 1_000, 2, 5)
    ).resolves.toMatchObject({
      expiresAt: 4_000,
      item: { status: "uploading", attemptCount: 0 },
    });
    await expect(
      store.updateClaimed("queue-1", SCOPE, "runner-b", timer.now, {
        status: "uploading",
      })
    ).resolves.toMatchObject({ leaseOwner: "runner-b" });

    finishUpload();
    releaseRenewal.resolve();
    await running;

    await expect(store.get("queue-1", SCOPE)).resolves.toMatchObject({
      status: "uploading",
      leaseOwner: "runner-b",
      uploadSlotOwner: "runner-b",
    });
    await runner.stop();
  });

  it("replays an unsettled upload after watchdog expiry without an external wake", async () => {
    const renewalStarted = deferred();
    const releaseRenewal = deferred();
    class ObservedRecoveryStore extends MemoryPhotoUploadQueueStore {
      recoveredItems = 0;

      override async renewUploadClaim(): Promise<PhotoUploadClaim | null> {
        renewalStarted.resolve();
        await releaseRenewal.promise;
        return null;
      }

      override async recoverInterrupted(
        scope: PhotoUploadScope,
        now: number,
        maxAttempts?: number
      ): Promise<number> {
        const recovered = await super.recoverInterrupted(scope, now, maxAttempts);
        this.recoveredItems += recovered;
        return recovered;
      }
    }
    const store = new ObservedRecoveryStore(createMemoryPhotoUploadQueueDatabase());
    await store.put(SCOPE, queuedPhoto());
    const timer = new ManualClockTimer();
    const staleUpload = deferred<{ ok: true; photoId: string }>();
    const replayedUpload = deferred<{ ok: true; photoId: string }>();
    let staleSignal: AbortSignal | undefined;
    const uploader = vi
      .fn()
      .mockImplementationOnce((_item: QueuedPhotoUpload, signal: AbortSignal) => {
        staleSignal = signal;
        return staleUpload.promise;
      })
      .mockImplementationOnce(() => replayedUpload.promise);
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
      leaseTtlMs: 1_000,
      maxAttempts: 1,
    });

    const running = runner.start();
    try {
      await vi.waitFor(() => expect(uploader).toHaveBeenCalledTimes(1));
      timer.advanceBy(500);
      await renewalStarted.promise;
      timer.advanceBy(500);

      await vi.waitFor(() => expect(uploader).toHaveBeenCalledTimes(2));
      await expect(store.get("queue-1", SCOPE)).resolves.toMatchObject({
        status: "uploading",
        attemptCount: 0,
        leaseOwner: "runner-a",
      });
      expect(staleSignal?.aborted).toBe(true);
      expect(store.recoveredItems).toBe(1);

      staleUpload.resolve({ ok: true, photoId: "stale-photo" });
      await Promise.resolve();
      await expect(store.get("queue-1", SCOPE)).resolves.toMatchObject({
        status: "uploading",
        attemptCount: 0,
      });

      replayedUpload.resolve({ ok: true, photoId: "replayed-photo" });
      await vi.waitFor(async () => {
        expect(await store.get("queue-1", SCOPE)).toBeNull();
      });
    } finally {
      staleUpload.resolve({ ok: true, photoId: "stale-photo" });
      replayedUpload.resolve({ ok: true, photoId: "replayed-photo" });
      releaseRenewal.resolve();
      await runner.stop();
      await running;
    }
  });

  it("requeues and resumes a non-final attempt after watchdog expiry", async () => {
    const renewalStarted = deferred();
    const releaseRenewal = deferred();
    class ObservedRecoveryStore extends MemoryPhotoUploadQueueStore {
      recoveredItems = 0;
      recoveredStatuses: string[] = [];

      override async renewUploadClaim(): Promise<PhotoUploadClaim | null> {
        renewalStarted.resolve();
        await releaseRenewal.promise;
        return null;
      }

      override async recoverInterrupted(
        scope: PhotoUploadScope,
        now: number,
        maxAttempts?: number
      ): Promise<number> {
        const recovered = await super.recoverInterrupted(scope, now, maxAttempts);
        if (recovered > 0) {
          this.recoveredItems += recovered;
          const item = await this.get("queue-1", scope);
          if (item) this.recoveredStatuses.push(item.status);
        }
        return recovered;
      }
    }
    const store = new ObservedRecoveryStore(createMemoryPhotoUploadQueueDatabase());
    await store.put(SCOPE, queuedPhoto());
    const timer = new ManualClockTimer();
    const staleUpload = deferred<{ ok: true; photoId: string }>();
    const resumedUpload = deferred<{ ok: true; photoId: string }>();
    let staleSignal: AbortSignal | undefined;
    const uploader = vi
      .fn()
      .mockImplementationOnce((_item: QueuedPhotoUpload, signal: AbortSignal) => {
        staleSignal = signal;
        return staleUpload.promise;
      })
      .mockImplementationOnce(() => resumedUpload.promise);
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
      leaseTtlMs: 1_000,
      maxAttempts: 2,
    });

    const running = runner.start();
    try {
      await vi.waitFor(() => expect(uploader).toHaveBeenCalledTimes(1));
      timer.advanceBy(500);
      await renewalStarted.promise;
      timer.advanceBy(500);

      await vi.waitFor(() => expect(uploader).toHaveBeenCalledTimes(2));
      expect(staleSignal?.aborted).toBe(true);
      expect(store.recoveredItems).toBe(1);
      expect(store.recoveredStatuses).toEqual(["queued"]);
      await expect(store.get("queue-1", SCOPE)).resolves.toMatchObject({
        status: "uploading",
        attemptCount: 0,
        leaseOwner: "runner-a",
      });

      staleUpload.resolve({ ok: true, photoId: "stale-photo" });
      await Promise.resolve();
      await expect(store.get("queue-1", SCOPE)).resolves.toMatchObject({
        status: "uploading",
        attemptCount: 0,
      });

      resumedUpload.resolve({ ok: true, photoId: "resumed-photo" });
      await running;
      await vi.waitFor(async () => {
        expect(await store.get("queue-1", SCOPE)).toBeNull();
      });
      expect(uploader).toHaveBeenCalledTimes(2);
    } finally {
      staleUpload.resolve({ ok: true, photoId: "stale-photo" });
      resumedUpload.resolve({ ok: true, photoId: "resumed-photo" });
      releaseRenewal.resolve();
      await runner.stop();
      await running;
    }
  });

  it("concurrent scheduler: recovers an expired upload while another stays active", async () => {
    const releaseExpiredRenewal = deferred();
    const expiredRenewalStarted = deferred();
    class SelectiveRenewalStore extends MemoryPhotoUploadQueueStore {
      override async renewUploadClaim(
        queueId: string,
        scope: PhotoUploadScope,
        owner: string,
        now: number,
        ttlMs: number
      ): Promise<PhotoUploadClaim | null> {
        if (queueId === "queue-a") {
          expiredRenewalStarted.resolve();
          await releaseExpiredRenewal.promise;
          return null;
        }
        return super.renewUploadClaim(queueId, scope, owner, now, ttlMs);
      }
    }
    const store = new SelectiveRenewalStore(createMemoryPhotoUploadQueueDatabase());
    await store.put(
      SCOPE,
      queuedPhoto({ queueId: "queue-a", clientUploadId: "client-a" })
    );
    await store.put(
      SCOPE,
      queuedPhoto({ queueId: "queue-b", clientUploadId: "client-b" })
    );
    const timer = new ManualClockTimer();
    const uploads = new Map<
      string,
      Array<ReturnType<typeof deferred<{ ok: true; photoId: string }>>>
    >();
    const signals = new Map<string, AbortSignal[]>();
    const uploader = vi.fn((item: QueuedPhotoUpload, signal: AbortSignal) => {
      const itemSignals = signals.get(item.queueId) ?? [];
      itemSignals.push(signal);
      signals.set(item.queueId, itemSignals);
      const upload = deferred<{ ok: true; photoId: string }>();
      const itemUploads = uploads.get(item.queueId) ?? [];
      itemUploads.push(upload);
      uploads.set(item.queueId, itemUploads);
      return upload.promise;
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
      leaseTtlMs: 1_000,
      maxAttempts: 1,
    });

    const starting = runner.start();
    try {
      await vi.waitFor(() => expect(uploader).toHaveBeenCalledTimes(2));
      timer.advanceBy(500);
      await expiredRenewalStarted.promise;
      await vi.waitFor(async () => {
        expect(await store.get("queue-b", SCOPE)).toMatchObject({
          leaseExpiresAt: 3_500,
        });
      });

      timer.advanceBy(500);
      await vi.waitFor(() => expect(uploader).toHaveBeenCalledTimes(3));
      await expect(store.get("queue-a", SCOPE)).resolves.toMatchObject({
        status: "uploading",
        attemptCount: 0,
        leaseOwner: "runner-a",
      });
      expect(signals.get("queue-a")?.[0]?.aborted).toBe(true);
      expect(signals.get("queue-a")?.[1]?.aborted).toBe(false);
      expect(signals.get("queue-b")?.[0]?.aborted).toBe(false);
      const activeB = await store.get("queue-b", SCOPE);
      expect(activeB).toMatchObject({
        status: "uploading",
        leaseOwner: "runner-a",
      });
      expect(activeB?.leaseExpiresAt).toBeGreaterThan(timer.now);

      uploads.get("queue-a")?.[0]?.resolve({
        ok: true,
        photoId: "stale-photo-a",
      });
      await Promise.resolve();
      await expect(store.get("queue-a", SCOPE)).resolves.toMatchObject({
        status: "uploading",
        attemptCount: 0,
      });

      uploads.get("queue-a")?.[1]?.resolve({ ok: true, photoId: "photo-a" });
      uploads.get("queue-b")?.[0]?.resolve({ ok: true, photoId: "photo-b" });
      await vi.waitFor(async () => {
        expect(await store.list(SCOPE)).toEqual([]);
      });
    } finally {
      for (const itemUploads of uploads.values()) {
        for (const upload of itemUploads) {
          upload.resolve({ ok: true, photoId: "cleanup-photo" });
        }
      }
      releaseExpiredRenewal.resolve();
      await runner.stop();
      await starting;
    }
  });

  it("concurrent scheduler: starts a due retry while another upload remains active", async () => {
    const store = new MemoryPhotoUploadQueueStore(createMemoryPhotoUploadQueueDatabase());
    await store.put(
      SCOPE,
      queuedPhoto({ queueId: "queue-b", clientUploadId: "client-b" })
    );
    await store.put(
      SCOPE,
      queuedPhoto({
        queueId: "queue-a",
        clientUploadId: "client-a",
        status: "retry_wait",
        attemptCount: 1,
        retryAt: 3_000,
      })
    );
    const timer = new ManualClockTimer();
    const uploads = new Map<
      string,
      ReturnType<typeof deferred<{ ok: true; photoId: string }>>
    >();
    const uploader = vi.fn((item: QueuedPhotoUpload) => {
      const upload = deferred<{ ok: true; photoId: string }>();
      uploads.set(item.queueId, upload);
      return upload.promise;
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
      leaseTtlMs: 10_000,
    });

    const starting = runner.start();
    try {
      await vi.waitFor(() => expect(uploader).toHaveBeenCalledTimes(1));
      expect(uploader.mock.calls[0]?.[0]).toMatchObject({
        queueId: "queue-b",
      });
      expect(timer.nextDelay).toBe(1_000);

      timer.advanceBy(1_000);
      await vi.waitFor(() => expect(uploader).toHaveBeenCalledTimes(2));
      expect(uploader.mock.calls[1]?.[0]).toMatchObject({
        queueId: "queue-a",
      });
      await expect(store.get("queue-b", SCOPE)).resolves.toMatchObject({
        status: "uploading",
      });

      uploads.get("queue-a")?.resolve({ ok: true, photoId: "photo-a" });
      uploads.get("queue-b")?.resolve({ ok: true, photoId: "photo-b" });
      await vi.waitFor(async () => {
        expect(await store.list(SCOPE)).toEqual([]);
      });
    } finally {
      uploads.get("queue-a")?.resolve({ ok: true, photoId: "photo-a" });
      uploads.get("queue-b")?.resolve({ ok: true, photoId: "photo-b" });
      await runner.stop();
      await starting;
    }
  });

  it("concurrent scheduler: recovers settlement after expiry before a delayed watchdog", async () => {
    const store = new MemoryPhotoUploadQueueStore(createMemoryPhotoUploadQueueDatabase());
    await store.put(SCOPE, queuedPhoto());
    const timer = new ManualClockTimer();
    const upload = deferred<{ ok: true; photoId: string }>();
    const uploader = vi.fn(() => upload.promise);
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
      leaseTtlMs: 1_000,
      maxAttempts: 1,
    });

    const starting = runner.start();
    try {
      await vi.waitFor(async () => {
        expect(await store.get("queue-1", SCOPE)).toMatchObject({
          status: "uploading",
          leaseExpiresAt: 3_000,
        });
      });
      timer.now = 3_001;
      upload.resolve({ ok: true, photoId: "late-photo" });

      await vi.waitFor(async () => {
        expect(await store.get("queue-1", SCOPE)).toBeNull();
      });
      expect(uploader).toHaveBeenCalledTimes(2);
    } finally {
      upload.resolve({ ok: true, photoId: "late-photo" });
      await runner.stop();
      await starting;
    }
  });

  it("concurrent scheduler: retains earlier uploads when availability changes during a later claim", async () => {
    const secondClaimed = deferred();
    const releaseSecondClaim = deferred();
    const settlementError = new PhotoQueuePersistenceError(
      "persistence_failed",
      "IndexedDB settlement failed."
    );
    class BlockingSecondClaimStore extends MemoryPhotoUploadQueueStore {
      claimCalls = 0;

      override async tryAcquireUploadClaim(
        queueId: string,
        scope: PhotoUploadScope,
        owner: string,
        now: number,
        ttlMs: number,
        maxScopeSlots: number,
        maxAttempts: number
      ): Promise<AcquiredPhotoUploadClaim | null> {
        this.claimCalls += 1;
        const claim = await super.tryAcquireUploadClaim(
          queueId,
          scope,
          owner,
          now,
          ttlMs,
          maxScopeSlots,
          maxAttempts
        );
        if (this.claimCalls === 2) {
          secondClaimed.resolve();
          await releaseSecondClaim.promise;
        }
        return claim;
      }

      override async completeClaimedUpload(
        queueId: string,
        scope: PhotoUploadScope,
        owner: string,
        now: number,
        confirmation: { photoId: string; clientUploadId: string }
      ): Promise<boolean> {
        if (queueId === "queue-1") throw settlementError;
        return super.completeClaimedUpload(queueId, scope, owner, now, confirmation);
      }
    }
    const store = new BlockingSecondClaimStore(createMemoryPhotoUploadQueueDatabase());
    await store.put(SCOPE, queuedPhoto());
    await store.put(
      SCOPE,
      queuedPhoto({
        queueId: "queue-2",
        clientUploadId: "client-upload-2",
      })
    );
    const firstUpload = deferred<{ ok: true; photoId: string }>();
    const uploader = vi.fn(() => firstUpload.promise);
    const onError = vi.fn();
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);
    let visible = true;
    const runner = new PhotoUploadQueueRunner({
      scope: SCOPE,
      store,
      uploader,
      now: () => 2_000,
      timer: { setTimeout: () => 1, clearTimeout: () => undefined },
      isOnline: () => true,
      isVisible: () => visible,
      eventTarget: new EventTarget(),
      ownerId: "runner-a",
      onError,
    });

    const starting = runner.start();
    try {
      await vi.waitFor(() => expect(uploader).toHaveBeenCalledTimes(1));
      await secondClaimed.promise;
      visible = false;
      releaseSecondClaim.resolve();
      await starting;

      firstUpload.resolve({ ok: true, photoId: "photo-1" });
      await flushUnhandledRejections();

      expect(onError).toHaveBeenCalledTimes(1);
      expect(onError.mock.calls[0]?.[0]).toMatchObject({
        name: "PhotoUploadQueueRunnerError",
        source: "upload_settlement",
        cause: settlementError,
      });
      expect(unhandled).toEqual([]);
      expect(uploader).toHaveBeenCalledTimes(1);
      await expect(store.get("queue-1", SCOPE)).resolves.toMatchObject({
        status: "queued",
        leaseOwner: null,
      });
      await expect(store.get("queue-2", SCOPE)).resolves.toMatchObject({
        status: "queued",
        leaseOwner: null,
      });
    } finally {
      visible = false;
      releaseSecondClaim.resolve();
      firstUpload.resolve({ ok: true, photoId: "photo-1" });
      await runner.stop();
      await starting.catch(() => undefined);
      await flushUnhandledRejections();
      process.off("unhandledRejection", onUnhandled);
    }
  });

  it("concurrent scheduler: start and wake schedule work while stop consumes tracked promises", async () => {
    const store = new MemoryPhotoUploadQueueStore(createMemoryPhotoUploadQueueDatabase());
    await store.put(SCOPE, queuedPhoto());
    const rejectUploads: Array<(reason: unknown) => void> = [];
    const signals: AbortSignal[] = [];
    const uploader = vi.fn(
      (_item: QueuedPhotoUpload, signal: AbortSignal) =>
        new Promise<never>((_resolve, reject) => {
          signals.push(signal);
          rejectUploads.push(reject);
        })
    );
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);
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

    const starting = runner.start();
    try {
      await vi.waitFor(() => expect(uploader).toHaveBeenCalledTimes(1));
      let startSettled = false;
      void starting.then(() => {
        startSettled = true;
      });
      await vi.waitFor(() => expect(startSettled).toBe(true));

      await store.put(
        SCOPE,
        queuedPhoto({
          queueId: "queue-2",
          clientUploadId: "client-upload-2",
        })
      );
      await runner.wake();
      expect(uploader).toHaveBeenCalledTimes(2);
      expect(signals.every((signal) => !signal.aborted)).toBe(true);

      await runner.stop();
      expect(signals.every((signal) => signal.aborted)).toBe(true);
      for (const reject of rejectUploads) {
        reject(new Error("late uploader rejection"));
      }
      await flushUnhandledRejections();

      expect(unhandled).toEqual([]);
      await expect(store.list(SCOPE)).resolves.toMatchObject([
        { status: "queued", leaseOwner: null },
        { status: "queued", leaseOwner: null },
      ]);
    } finally {
      await runner.stop();
      for (const reject of rejectUploads) {
        reject(new Error("cleanup rejection"));
      }
      await starting.catch(() => undefined);
      await flushUnhandledRejections();
      process.off("unhandledRejection", onUnhandled);
    }
  });

  it("retries a transient lease-renewal error before ownership expires", async () => {
    class FlakyRenewalStore extends MemoryPhotoUploadQueueStore {
      claimCalls = 0;

      override async tryAcquireUploadClaim(
        queueId: string,
        scope: PhotoUploadScope,
        owner: string,
        now: number,
        ttlMs: number,
        maxScopeSlots: number,
        maxAttempts: number
      ): Promise<AcquiredPhotoUploadClaim | null> {
        this.claimCalls += 1;
        return super.tryAcquireUploadClaim(
          queueId,
          scope,
          owner,
          now,
          ttlMs,
          maxScopeSlots,
          maxAttempts
        );
      }

      override async renewUploadClaim(
        queueId: string,
        scope: PhotoUploadScope,
        owner: string,
        now: number,
        ttlMs: number
      ): Promise<PhotoUploadClaim | null> {
        this.claimCalls += 1;
        if (this.claimCalls === 2) {
          throw new DOMException("IndexedDB is temporarily unavailable.", "UnknownError");
        }
        return super.renewUploadClaim(queueId, scope, owner, now, ttlMs);
      }
    }
    const store = new FlakyRenewalStore(createMemoryPhotoUploadQueueDatabase());
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
    await vi.waitFor(() => expect(store.claimCalls).toBe(1));

    timer.advanceBy(500);
    await vi.waitFor(() => expect(store.claimCalls).toBe(2));
    expect(timer.nextDelay).not.toBeNull();

    timer.advanceBy(timer.nextDelay!);
    await vi.waitFor(() => expect(store.claimCalls).toBe(3));
    await expect(store.get("queue-1", SCOPE)).resolves.toMatchObject({
      leaseOwner: "runner-a",
      leaseExpiresAt: 3_750,
    });

    finishUpload();
    await running;
    runner.stop();
  });

  it("aborts and fences stale completion after lease ownership is lost", async () => {
    class LosingLeaseStore extends MemoryPhotoUploadQueueStore {
      claimCalls = 0;

      override async tryAcquireUploadClaim(
        queueId: string,
        scope: PhotoUploadScope,
        owner: string,
        now: number,
        ttlMs: number,
        maxScopeSlots: number,
        maxAttempts: number
      ): Promise<AcquiredPhotoUploadClaim | null> {
        this.claimCalls += 1;
        return super.tryAcquireUploadClaim(
          queueId,
          scope,
          owner,
          now,
          ttlMs,
          maxScopeSlots,
          maxAttempts
        );
      }

      override async renewUploadClaim(
        queueId: string,
        scope: PhotoUploadScope,
        owner: string,
        now: number,
        ttlMs: number
      ): Promise<PhotoUploadClaim | null> {
        this.claimCalls += 1;
        await super.releaseUploadClaim(queueId, scope, owner, now);
        await super.tryAcquireUploadClaim(queueId, scope, "runner-b", now, ttlMs, 2, 5);
        await super.updateClaimed(queueId, scope, "runner-b", now, {
          status: "uploading",
        });
        return null;
      }
    }
    const store = new LosingLeaseStore(createMemoryPhotoUploadQueueDatabase());
    await store.put(SCOPE, queuedPhoto());
    const timer = new ManualClockTimer();
    let finishUpload: () => void = () => {};
    let uploadSignal: AbortSignal | undefined;
    const runner = new PhotoUploadQueueRunner({
      scope: SCOPE,
      store,
      uploader: (_item, signal?: AbortSignal) => {
        uploadSignal = signal;
        return new Promise<{ ok: true; photoId: string }>((resolve) => {
          finishUpload = () => resolve({ ok: true, photoId: "stale-photo" });
        });
      },
      now: () => timer.now,
      timer,
      isOnline: () => true,
      isVisible: () => true,
      eventTarget: new EventTarget(),
      ownerId: "runner-a",
      leaseTtlMs: 1_000,
    });

    const running = runner.start();
    await vi.waitFor(() => expect(uploadSignal).toBeDefined());
    timer.advanceBy(500);
    await vi.waitFor(async () => {
      expect(await store.get("queue-1", SCOPE)).toMatchObject({
        leaseOwner: "runner-b",
      });
    });

    expect(uploadSignal?.aborted).toBe(true);
    finishUpload();
    await running;

    await expect(store.get("queue-1", SCOPE)).resolves.toMatchObject({
      status: "uploading",
      leaseOwner: "runner-b",
      uploadSlotOwner: "runner-b",
    });
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
        uploadSlotOwner: "closed-tab",
        uploadSlotExpiresAt: 3_000,
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
        uploadSlotOwner: "runner-a",
        uploadSlotExpiresAt: 3_000,
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

  it("repumps when wake is requested during active store work", async () => {
    const firstListStarted = deferred();
    const releaseFirstList = deferred();
    class BlockingListStore extends MemoryPhotoUploadQueueStore {
      private listCount = 0;

      override async list(scope: PhotoUploadScope): Promise<QueuedPhotoUpload[]> {
        this.listCount += 1;
        if (this.listCount !== 1) return super.list(scope);
        const snapshot = await super.list(scope);
        firstListStarted.resolve();
        await releaseFirstList.promise;
        return snapshot;
      }
    }
    const store = new BlockingListStore(createMemoryPhotoUploadQueueDatabase());
    const uploader = vi.fn().mockResolvedValue({ ok: true, photoId: "photo-1" });
    const events = new EventTarget();
    const runner = new PhotoUploadQueueRunner({
      scope: SCOPE,
      store,
      uploader,
      now: () => 2_000,
      timer: { setTimeout: () => 1, clearTimeout: () => undefined },
      isOnline: () => true,
      isVisible: () => true,
      eventTarget: events,
      ownerId: "runner-a",
    });

    const starting = runner.start();
    await firstListStarted.promise;
    await store.put(SCOPE, queuedPhoto());
    events.dispatchEvent(new Event("pageshow"));
    releaseFirstList.resolve();
    await starting;

    expect(uploader).toHaveBeenCalledTimes(1);
    await expect(store.get("queue-1", SCOPE)).resolves.toBeNull();
    runner.stop();
  });

  it("does not claim after going offline during an awaited list", async () => {
    const listStarted = deferred();
    const releaseList = deferred();
    class BlockingListStore extends MemoryPhotoUploadQueueStore {
      override async list(scope: PhotoUploadScope): Promise<QueuedPhotoUpload[]> {
        const snapshot = await super.list(scope);
        listStarted.resolve();
        await releaseList.promise;
        return snapshot;
      }
    }
    const store = new BlockingListStore(createMemoryPhotoUploadQueueDatabase());
    await store.put(SCOPE, queuedPhoto());
    let online = true;
    const uploader = vi.fn().mockResolvedValue({ ok: true, photoId: "photo-1" });
    const runner = new PhotoUploadQueueRunner({
      scope: SCOPE,
      store,
      uploader,
      now: () => 2_000,
      timer: { setTimeout: () => 1, clearTimeout: () => undefined },
      isOnline: () => online,
      isVisible: () => true,
      eventTarget: new EventTarget(),
      ownerId: "runner-a",
    });

    const starting = runner.start();
    await listStarted.promise;
    online = false;
    releaseList.resolve();
    await starting;

    expect(uploader).not.toHaveBeenCalled();
    await expect(store.get("queue-1", SCOPE)).resolves.toMatchObject({
      status: "queued",
      leaseOwner: null,
    });
    runner.stop();
  });

  it("rechecks visibility immediately before invoking the uploader", async () => {
    const claimPersisted = deferred();
    const releaseClaim = deferred();
    class BlockingClaimStore extends MemoryPhotoUploadQueueStore {
      override async tryAcquireUploadClaim(
        queueId: string,
        scope: PhotoUploadScope,
        owner: string,
        now: number,
        ttlMs: number,
        maxScopeSlots: number,
        maxAttempts: number
      ): Promise<AcquiredPhotoUploadClaim | null> {
        const acquired = await super.tryAcquireUploadClaim(
          queueId,
          scope,
          owner,
          now,
          ttlMs,
          maxScopeSlots,
          maxAttempts
        );
        if (acquired) {
          claimPersisted.resolve();
          await releaseClaim.promise;
        }
        return acquired;
      }
    }
    const store = new BlockingClaimStore(createMemoryPhotoUploadQueueDatabase());
    await store.put(SCOPE, queuedPhoto());
    let visible = true;
    const uploader = vi.fn().mockResolvedValue({ ok: true, photoId: "photo-1" });
    const runner = new PhotoUploadQueueRunner({
      scope: SCOPE,
      store,
      uploader,
      now: () => 2_000,
      timer: { setTimeout: () => 1, clearTimeout: () => undefined },
      isOnline: () => true,
      isVisible: () => visible,
      eventTarget: new EventTarget(),
      ownerId: "runner-a",
    });

    const starting = runner.start();
    await claimPersisted.promise;
    visible = false;
    releaseClaim.resolve();
    await starting;

    expect(uploader).not.toHaveBeenCalled();
    await expect(store.get("queue-1", SCOPE)).resolves.toMatchObject({
      status: "queued",
      leaseOwner: null,
    });
    runner.stop();
  });

  it("does not claim an item after stop during awaited store work", async () => {
    const listStarted = deferred();
    const releaseList = deferred();
    class BlockingListStore extends MemoryPhotoUploadQueueStore {
      override async list(scope: PhotoUploadScope): Promise<QueuedPhotoUpload[]> {
        const snapshot = await super.list(scope);
        listStarted.resolve();
        await releaseList.promise;
        return snapshot;
      }
    }
    const store = new BlockingListStore(createMemoryPhotoUploadQueueDatabase());
    await store.put(SCOPE, queuedPhoto());
    const uploader = vi.fn().mockResolvedValue({ ok: true, photoId: "photo-1" });
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

    const starting = runner.start();
    await listStarted.promise;
    await runner.stop();
    releaseList.resolve();
    await starting;

    expect(uploader).not.toHaveBeenCalled();
    await expect(store.get("queue-1", SCOPE)).resolves.toMatchObject({
      status: "queued",
      leaseOwner: null,
    });
  });

  it("releases active work on stop and never starts the next item", async () => {
    const store = new MemoryPhotoUploadQueueStore(createMemoryPhotoUploadQueueDatabase());
    await store.put(SCOPE, queuedPhoto());
    await store.put(
      SCOPE,
      queuedPhoto({
        queueId: "queue-2",
        clientUploadId: "client-upload-2",
      })
    );
    let finishUpload: () => void = () => {};
    let uploadSignal: AbortSignal | undefined;
    const uploader = vi.fn(
      (_item: QueuedPhotoUpload, signal: AbortSignal) =>
        new Promise<{ ok: true; photoId: string }>((resolve) => {
          uploadSignal = signal;
          finishUpload = () => resolve({ ok: true, photoId: "stale-photo" });
        })
    );
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
      maxConcurrency: 1,
    });

    const running = runner.start();
    await vi.waitFor(() => expect(uploader).toHaveBeenCalledTimes(1));
    await runner.stop();
    expect(uploadSignal?.aborted).toBe(true);
    finishUpload();
    await running;

    expect(uploader).toHaveBeenCalledTimes(1);
    await expect(store.list(SCOPE)).resolves.toMatchObject([
      { status: "queued", leaseOwner: null },
      { status: "queued", leaseOwner: null },
    ]);
  });

  it("requeues an unsettled active upload when stopped without counting a failure", async () => {
    const store = new MemoryPhotoUploadQueueStore(createMemoryPhotoUploadQueueDatabase());
    await store.put(SCOPE, queuedPhoto());
    const uploader = vi.fn(
      (_item: QueuedPhotoUpload, signal: AbortSignal) =>
        new Promise<{ ok: true; photoId: string }>((resolve) => {
          signal.addEventListener(
            "abort",
            () => resolve({ ok: true, photoId: "stale-photo" }),
            { once: true }
          );
        })
    );
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
      maxAttempts: 1,
    });

    const running = runner.start();
    await vi.waitFor(() => expect(uploader).toHaveBeenCalledTimes(1));
    await runner.stop();
    await running;

    await expect(store.get("queue-1", SCOPE)).resolves.toMatchObject({
      status: "queued",
      attemptCount: 0,
      retryAt: null,
      lastError: null,
      leaseOwner: null,
      uploadSlotOwner: null,
    });
  });
});
