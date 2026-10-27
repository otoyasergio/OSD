import { describe, expect, it, vi } from "vitest";
import { PhotoQueuePersistenceError } from "@/lib/photos/uploadQueue/errors";
import {
  createIndexedDatabaseOpener,
  IndexedDbPhotoUploadQueueStore,
  PHOTO_UPLOAD_QUEUE_DB_NAME,
  PHOTO_UPLOAD_QUEUE_DB_VERSION,
} from "@/lib/photos/uploadQueue/indexedDbStore";
import type { QueuedPhotoUpload } from "@/lib/photos/uploadQueue/types";

const SCOPE = { userId: "user-a", locationId: "location-a" };

function fakeDatabase() {
  const close = vi.fn();
  return {
    close,
    transaction() {
      return {
        objectStore() {
          return {
            get: async () => undefined,
            getAll: async () => [],
            put: async () => undefined,
            delete: async () => undefined,
            index() {
              return { getAll: async () => [] };
            },
          };
        },
        done: Promise.resolve(),
      };
    },
    objectStoreNames: { contains: () => true },
  };
}

describe("IndexedDB photo queue opener", () => {
  it("closes this connection when a later tab upgrade is blocked by it", async () => {
    const db = fakeDatabase();
    let blocking: (() => void) | undefined;
    const open = vi.fn(async (_name, _version, options: { blocking?: () => void }) => {
      blocking = options.blocking;
      return db;
    });
    const opener = createIndexedDatabaseOpener(open as never);
    const opened = await opener(
      PHOTO_UPLOAD_QUEUE_DB_NAME,
      PHOTO_UPLOAD_QUEUE_DB_VERSION
    );
    expect(open).toHaveBeenCalledWith(
      PHOTO_UPLOAD_QUEUE_DB_NAME,
      PHOTO_UPLOAD_QUEUE_DB_VERSION,
      expect.objectContaining({
        upgrade: expect.any(Function),
        blocked: expect.any(Function),
        blocking: expect.any(Function),
      })
    );
    blocking?.();
    expect(db.close).toHaveBeenCalled();
    opened.close?.();
  });

  it("rejects a blocked upgrade and closes a late-opened database", async () => {
    const db = fakeDatabase();
    let resolveOpen: ((value: ReturnType<typeof fakeDatabase>) => void) | undefined;
    let blocked: (() => void) | undefined;
    const open = vi.fn(
      (_name: string, _version: number, options: { blocked?: () => void }) => {
        blocked = options.blocked;
        return new Promise<ReturnType<typeof fakeDatabase>>((resolve) => {
          resolveOpen = resolve;
        });
      }
    );
    const opener = createIndexedDatabaseOpener(open as never);
    const pending = opener(PHOTO_UPLOAD_QUEUE_DB_NAME, PHOTO_UPLOAD_QUEUE_DB_VERSION);
    blocked?.();
    await expect(pending).rejects.toMatchObject({
      name: "PhotoQueuePersistenceError",
      code: "upgrade_blocked",
    });
    resolveOpen?.(db);
    await Promise.resolve();
    await Promise.resolve();
    expect(db.close).toHaveBeenCalled();
  });

  it("closes and clears the exact cached connection on versionchange blocking then reopens", async () => {
    const first = fakeDatabase();
    const second = fakeDatabase();
    let attempt = 0;
    let firstBlocking: (() => void) | undefined;
    const open = vi.fn(async (_name, _version, options: { blocking?: () => void }) => {
      attempt += 1;
      if (attempt === 1) {
        firstBlocking = options.blocking;
        return first;
      }
      return second;
    });
    const store = new IndexedDbPhotoUploadQueueStore({
      openDatabase: createIndexedDatabaseOpener(open as never),
    });
    await expect(store.list(SCOPE)).resolves.toEqual([]);
    expect(attempt).toBe(1);

    firstBlocking?.();
    expect(first.close).toHaveBeenCalled();

    await expect(store.list(SCOPE)).resolves.toEqual([]);
    expect(attempt).toBe(2);
    expect(second.close).not.toHaveBeenCalled();

    firstBlocking?.();
    expect(second.close).not.toHaveBeenCalled();
    await expect(store.list(SCOPE)).resolves.toEqual([]);
    expect(attempt).toBe(2);
  });

  it("reopens after a blocked upgrade once the other tab closes", async () => {
    let attempt = 0;
    const open = vi.fn(async (_name, _version, options: { blocked?: () => void }) => {
      attempt += 1;
      if (attempt === 1) {
        options.blocked?.();
        return new Promise(() => {});
      }
      return fakeDatabase();
    });
    const store = new IndexedDbPhotoUploadQueueStore({
      openDatabase: createIndexedDatabaseOpener(open as never),
    });
    await expect(store.list(SCOPE)).rejects.toBeInstanceOf(PhotoQueuePersistenceError);
    await expect(store.list(SCOPE)).resolves.toEqual([]);
    expect(attempt).toBe(2);
  });

  it("persists photo bytes instead of a Blob so WebKit can commit the record", async () => {
    const records = new Map<string, QueuedPhotoUpload & { bytes?: Uint8Array }>();
    const db = {
      close: vi.fn(),
      transaction() {
        return {
          objectStore() {
            return {
              get: async (queueId: string) => records.get(queueId),
              getAll: async () => [...records.values()],
              put: async (item: QueuedPhotoUpload & { bytes?: Uint8Array }) => {
                records.set(item.queueId, item);
              },
              delete: async (queueId: string) => {
                records.delete(queueId);
              },
              index() {
                return {
                  getAll: async () => [...records.values()],
                };
              },
            };
          },
          done: Promise.resolve(),
        };
      },
    };
    const queued: QueuedPhotoUpload = {
      queueId: "queue-1",
      clientUploadId: "client-1",
      userId: SCOPE.userId,
      locationId: SCOPE.locationId,
      category: "other",
      workOrderId: "wo-1",
      blob: new Blob([Uint8Array.from([9, 8, 7])], { type: "image/heic" }),
      fileName: "library.heic",
      mimeType: "image/heic",
      lastModified: 1,
      byteCount: 3,
      status: "queued",
      attemptCount: 0,
      retryAt: null,
      lastError: null,
      createdAt: 1,
      updatedAt: 1,
      leaseOwner: null,
      leaseExpiresAt: null,
      uploadSlotOwner: null,
      uploadSlotExpiresAt: null,
    };
    const store = new IndexedDbPhotoUploadQueueStore({
      openDatabase: createIndexedDatabaseOpener((async () => db) as never),
    });

    await store.put(SCOPE, queued);

    const stored = records.get("queue-1");
    expect(stored?.bytes).toBeInstanceOf(Uint8Array);
    expect(stored?.bytes).toEqual(Uint8Array.from([9, 8, 7]));
    expect(stored).not.toHaveProperty("blob");

    const loaded = await store.get("queue-1", SCOPE);
    expect(loaded?.blob).toBeInstanceOf(Blob);
    expect(loaded?.mimeType).toBe("image/heic");
    expect(new Uint8Array(await loaded!.blob.arrayBuffer())).toEqual(
      Uint8Array.from([9, 8, 7])
    );

    records.set("legacy", {
      ...queued,
      queueId: "legacy",
      clientUploadId: "legacy-client",
    });
    const legacy = await store.get("legacy", SCOPE);
    expect(legacy?.blob).toBe(queued.blob);
  });
});
