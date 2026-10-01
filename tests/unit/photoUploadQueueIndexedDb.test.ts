import { describe, expect, it, vi } from "vitest";
import { PhotoQueuePersistenceError } from "@/lib/photos/uploadQueue/errors";
import {
  createIndexedDatabaseOpener,
  IndexedDbPhotoUploadQueueStore,
  PHOTO_UPLOAD_QUEUE_DB_NAME,
  PHOTO_UPLOAD_QUEUE_DB_VERSION,
} from "@/lib/photos/uploadQueue/indexedDbStore";

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
});
