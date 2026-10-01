import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import {
  PhotoQueuePersistenceError,
  type PhotoQueuePersistenceErrorCode,
} from "./errors";
import {
  assertPhotoUploadTransition,
  InvalidPhotoUploadTransitionError,
} from "./stateTransitions";
import {
  type PhotoUploadClaim,
  PhotoUploadQueueScopeError,
  type PhotoUploadQueueStore,
} from "./store";
import type { PhotoUploadQueuePatch, PhotoUploadScope, QueuedPhotoUpload } from "./types";

export const PHOTO_UPLOAD_QUEUE_DB_NAME = "otomoto-photo-upload-queue";
export const PHOTO_UPLOAD_QUEUE_DB_VERSION = 2;

const PHOTO_UPLOAD_STORE_NAME = "photoUploads";
const PHOTO_UPLOAD_SCOPE_INDEX = "byUserAndLocation";

interface PhotoUploadQueueSchema extends DBSchema {
  photoUploads: {
    key: string;
    value: QueuedPhotoUpload;
    indexes: {
      byUserAndLocation: [string, string];
    };
  };
}

export type PhotoUploadQueueTransaction = {
  get(queueId: string): Promise<QueuedPhotoUpload | undefined>;
  listByScope(scope: PhotoUploadScope): Promise<QueuedPhotoUpload[]>;
  put(item: QueuedPhotoUpload): Promise<unknown>;
  delete(queueId: string): Promise<unknown>;
  done: Promise<void>;
};

export type PhotoUploadQueueDatabase = {
  transaction(mode: "readonly" | "readwrite"): PhotoUploadQueueTransaction;
  close?(): void;
};

export type PhotoUploadQueueDatabaseOpener = (
  name: string,
  version: number
) => Promise<PhotoUploadQueueDatabase>;

function wrapDatabase(
  database: IDBPDatabase<PhotoUploadQueueSchema>
): PhotoUploadQueueDatabase {
  return {
    transaction(mode) {
      const transaction = database.transaction(PHOTO_UPLOAD_STORE_NAME, mode);
      return {
        get: (queueId) => transaction.store.get(queueId),
        listByScope: (scope) =>
          transaction.store
            .index(PHOTO_UPLOAD_SCOPE_INDEX)
            .getAll([scope.userId, scope.locationId]),
        put: (item) => transaction.store.put!(item),
        delete: (queueId) => transaction.store.delete!(queueId),
        done: transaction.done,
      };
    },
    close: () => database.close(),
  };
}

const openIndexedDatabase: PhotoUploadQueueDatabaseOpener = async (name, version) => {
  const database = await openDB<PhotoUploadQueueSchema>(name, version, {
    upgrade(upgradeDatabase) {
      if (upgradeDatabase.objectStoreNames.contains(PHOTO_UPLOAD_STORE_NAME)) {
        return;
      }
      const store = upgradeDatabase.createObjectStore(PHOTO_UPLOAD_STORE_NAME, {
        keyPath: "queueId",
      });
      store.createIndex(PHOTO_UPLOAD_SCOPE_INDEX, ["userId", "locationId"]);
    },
  });
  return wrapDatabase(database);
};

function belongsToScope(item: QueuedPhotoUpload, scope: PhotoUploadScope): boolean {
  return item.userId === scope.userId && item.locationId === scope.locationId;
}

function ownsLiveUploadClaim(
  item: QueuedPhotoUpload,
  owner: string,
  now: number
): boolean {
  return (
    item.leaseOwner === owner &&
    item.leaseExpiresAt !== null &&
    item.leaseExpiresAt > now &&
    item.uploadSlotOwner === owner &&
    item.uploadSlotExpiresAt !== null &&
    item.uploadSlotExpiresAt > now
  );
}

function hasLivePersistedUploadClaim(item: QueuedPhotoUpload, now: number): boolean {
  const liveLease =
    item.leaseOwner !== null && item.leaseExpiresAt !== null && item.leaseExpiresAt > now;
  const hasSlotMetadata =
    Object.prototype.hasOwnProperty.call(item, "uploadSlotOwner") ||
    Object.prototype.hasOwnProperty.call(item, "uploadSlotExpiresAt");
  const liveSlot =
    item.uploadSlotOwner !== null &&
    item.uploadSlotExpiresAt !== null &&
    item.uploadSlotExpiresAt > now;
  return liveLease && (!hasSlotMetadata || liveSlot);
}

function persistenceError(error: unknown): PhotoQueuePersistenceError {
  if (error instanceof PhotoQueuePersistenceError) return error;
  const code: PhotoQueuePersistenceErrorCode =
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    error.name === "QuotaExceededError"
      ? "quota_exceeded"
      : "persistence_failed";
  return new PhotoQueuePersistenceError(
    code,
    code === "quota_exceeded"
      ? "This device does not have enough storage for the photo upload queue."
      : "The photo upload queue could not be updated.",
    { cause: error }
  );
}

export type IndexedDbPhotoUploadQueueStoreOptions = {
  databaseName?: string;
  openDatabase?: PhotoUploadQueueDatabaseOpener;
};

export class IndexedDbPhotoUploadQueueStore implements PhotoUploadQueueStore {
  private readonly database: Promise<PhotoUploadQueueDatabase>;

  constructor(options: IndexedDbPhotoUploadQueueStoreOptions = {}) {
    this.database = (options.openDatabase ?? openIndexedDatabase)(
      options.databaseName ?? PHOTO_UPLOAD_QUEUE_DB_NAME,
      PHOTO_UPLOAD_QUEUE_DB_VERSION
    );
  }

  async put(scope: PhotoUploadScope, item: QueuedPhotoUpload): Promise<void> {
    if (!belongsToScope(item, scope)) {
      throw new PhotoUploadQueueScopeError();
    }
    try {
      const transaction = (await this.database).transaction("readwrite");
      const existing = await transaction.get(item.queueId);
      if (existing && !belongsToScope(existing, scope)) {
        await transaction.done;
        throw new PhotoUploadQueueScopeError();
      }
      await transaction.put(item);
      await transaction.done;
    } catch (error) {
      if (error instanceof PhotoUploadQueueScopeError) throw error;
      throw persistenceError(error);
    }
  }

  async get(queueId: string, scope: PhotoUploadScope): Promise<QueuedPhotoUpload | null> {
    try {
      const transaction = (await this.database).transaction("readonly");
      const item = await transaction.get(queueId);
      await transaction.done;
      return item && belongsToScope(item, scope) ? item : null;
    } catch (error) {
      throw persistenceError(error);
    }
  }

  async list(scope: PhotoUploadScope): Promise<QueuedPhotoUpload[]> {
    try {
      const transaction = (await this.database).transaction("readonly");
      const items = await transaction.listByScope(scope);
      await transaction.done;
      return items
        .filter((item) => belongsToScope(item, scope))
        .sort(
          (left, right) =>
            left.createdAt - right.createdAt || left.queueId.localeCompare(right.queueId)
        );
    } catch (error) {
      throw persistenceError(error);
    }
  }

  async update(
    queueId: string,
    scope: PhotoUploadScope,
    patch: PhotoUploadQueuePatch
  ): Promise<QueuedPhotoUpload | null> {
    try {
      const transaction = (await this.database).transaction("readwrite");
      const item = await transaction.get(queueId);
      if (!item || !belongsToScope(item, scope)) {
        await transaction.done;
        return null;
      }
      if (patch.status) {
        assertPhotoUploadTransition(item.status, patch.status);
      }
      const updated = { ...item, ...patch };
      await transaction.put(updated);
      await transaction.done;
      return updated;
    } catch (error) {
      if (error instanceof InvalidPhotoUploadTransitionError) {
        throw error;
      }
      throw persistenceError(error);
    }
  }

  async remove(queueId: string, scope: PhotoUploadScope): Promise<void> {
    try {
      const transaction = (await this.database).transaction("readwrite");
      const item = await transaction.get(queueId);
      if (item && belongsToScope(item, scope)) {
        await transaction.delete(queueId);
      }
      await transaction.done;
    } catch (error) {
      throw persistenceError(error);
    }
  }

  async recoverInterrupted(scope: PhotoUploadScope, now: number): Promise<number> {
    try {
      const transaction = (await this.database).transaction("readwrite");
      const items = await transaction.listByScope(scope);
      let recovered = 0;
      for (const item of items) {
        if (
          !belongsToScope(item, scope) ||
          item.status !== "uploading" ||
          hasLivePersistedUploadClaim(item, now)
        ) {
          continue;
        }
        await transaction.put({
          ...item,
          status: "queued",
          retryAt: null,
          updatedAt: now,
          leaseOwner: null,
          leaseExpiresAt: null,
          uploadSlotOwner: null,
          uploadSlotExpiresAt: null,
        });
        recovered += 1;
      }
      await transaction.done;
      return recovered;
    } catch (error) {
      throw persistenceError(error);
    }
  }

  async tryAcquireLease(
    queueId: string,
    scope: PhotoUploadScope,
    owner: string,
    now: number,
    ttlMs: number
  ): Promise<boolean> {
    return (
      (await this.tryAcquireUploadClaim(queueId, scope, owner, now, ttlMs, 2)) !== null
    );
  }

  async tryAcquireUploadClaim(
    queueId: string,
    scope: PhotoUploadScope,
    owner: string,
    now: number,
    ttlMs: number,
    maxScopeSlots: number
  ): Promise<PhotoUploadClaim | null> {
    try {
      const transaction = (await this.database).transaction("readwrite");
      const item = await transaction.get(queueId);
      const scopeItems = await transaction.listByScope(scope);
      const processable =
        item?.status === "queued" ||
        item?.status === "retry_wait" ||
        item?.status === "uploading";
      const liveCompetingLease =
        item !== undefined &&
        item.leaseOwner !== null &&
        item.leaseOwner !== owner &&
        item.leaseExpiresAt !== null &&
        item.leaseExpiresAt > now;
      const liveCompetingSlot =
        item !== undefined &&
        item.uploadSlotOwner !== null &&
        item.uploadSlotOwner !== owner &&
        item.uploadSlotExpiresAt !== null &&
        item.uploadSlotExpiresAt > now;
      const alreadyOwnsLiveSlot =
        item?.uploadSlotOwner === owner &&
        item.uploadSlotExpiresAt !== null &&
        item.uploadSlotExpiresAt > now;
      const slotLimit = Math.min(2, Math.max(1, maxScopeSlots));
      const activeScopeSlots = scopeItems.filter(
        (candidate) =>
          candidate.uploadSlotOwner !== null &&
          candidate.uploadSlotExpiresAt !== null &&
          candidate.uploadSlotExpiresAt > now
      ).length;
      if (
        !item ||
        !belongsToScope(item, scope) ||
        !processable ||
        liveCompetingLease ||
        liveCompetingSlot ||
        (!alreadyOwnsLiveSlot && activeScopeSlots >= slotLimit)
      ) {
        await transaction.done;
        return null;
      }
      const expiresAt = now + ttlMs;
      await transaction.put({
        ...item,
        leaseOwner: owner,
        leaseExpiresAt: expiresAt,
        uploadSlotOwner: owner,
        uploadSlotExpiresAt: expiresAt,
      });
      await transaction.done;
      return { expiresAt };
    } catch (error) {
      throw persistenceError(error);
    }
  }

  async renewUploadClaim(
    queueId: string,
    scope: PhotoUploadScope,
    owner: string,
    now: number,
    ttlMs: number
  ): Promise<PhotoUploadClaim | null> {
    try {
      const transaction = (await this.database).transaction("readwrite");
      const item = await transaction.get(queueId);
      if (
        !item ||
        !belongsToScope(item, scope) ||
        !ownsLiveUploadClaim(item, owner, now)
      ) {
        await transaction.done;
        return null;
      }
      const expiresAt = now + ttlMs;
      await transaction.put({
        ...item,
        leaseExpiresAt: expiresAt,
        uploadSlotExpiresAt: expiresAt,
      });
      await transaction.done;
      return { expiresAt };
    } catch (error) {
      throw persistenceError(error);
    }
  }

  async updateClaimed(
    queueId: string,
    scope: PhotoUploadScope,
    owner: string,
    now: number,
    patch: PhotoUploadQueuePatch,
    releaseClaim = false
  ): Promise<QueuedPhotoUpload | null> {
    try {
      const transaction = (await this.database).transaction("readwrite");
      const item = await transaction.get(queueId);
      if (
        !item ||
        !belongsToScope(item, scope) ||
        !ownsLiveUploadClaim(item, owner, now)
      ) {
        await transaction.done;
        return null;
      }
      if (patch.status) {
        assertPhotoUploadTransition(item.status, patch.status);
      }
      const updated: QueuedPhotoUpload = {
        ...item,
        ...patch,
        ...(releaseClaim
          ? {
              leaseOwner: null,
              leaseExpiresAt: null,
              uploadSlotOwner: null,
              uploadSlotExpiresAt: null,
            }
          : {}),
      };
      await transaction.put(updated);
      await transaction.done;
      return updated;
    } catch (error) {
      if (error instanceof InvalidPhotoUploadTransitionError) throw error;
      throw persistenceError(error);
    }
  }

  async completeClaimedUpload(
    queueId: string,
    scope: PhotoUploadScope,
    owner: string,
    now: number
  ): Promise<boolean> {
    try {
      const transaction = (await this.database).transaction("readwrite");
      const item = await transaction.get(queueId);
      if (
        !item ||
        !belongsToScope(item, scope) ||
        item.status !== "uploading" ||
        !ownsLiveUploadClaim(item, owner, now)
      ) {
        await transaction.done;
        return false;
      }
      assertPhotoUploadTransition(item.status, "saved");
      await transaction.delete(queueId);
      await transaction.done;
      return true;
    } catch (error) {
      if (error instanceof InvalidPhotoUploadTransitionError) throw error;
      throw persistenceError(error);
    }
  }

  async releaseUploadClaim(
    queueId: string,
    scope: PhotoUploadScope,
    owner: string,
    now: number
  ): Promise<boolean> {
    try {
      const transaction = (await this.database).transaction("readwrite");
      const item = await transaction.get(queueId);
      if (!item || !belongsToScope(item, scope)) {
        await transaction.done;
        return false;
      }
      const ownsLease = item.leaseOwner === owner;
      const ownsSlot = item.uploadSlotOwner === owner;
      if (!ownsLease && !ownsSlot) {
        await transaction.done;
        return false;
      }
      const recoverToQueued = item.status === "uploading" && ownsLease && ownsSlot;
      await transaction.put({
        ...item,
        status: recoverToQueued ? "queued" : item.status,
        retryAt: recoverToQueued ? null : item.retryAt,
        updatedAt: now,
        leaseOwner: ownsLease ? null : item.leaseOwner,
        leaseExpiresAt: ownsLease ? null : item.leaseExpiresAt,
        uploadSlotOwner: ownsSlot ? null : item.uploadSlotOwner,
        uploadSlotExpiresAt: ownsSlot ? null : item.uploadSlotExpiresAt,
      });
      await transaction.done;
      return true;
    } catch (error) {
      throw persistenceError(error);
    }
  }

  async close(): Promise<void> {
    (await this.database).close?.();
  }
}
