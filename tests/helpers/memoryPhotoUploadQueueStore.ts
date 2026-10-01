import {
  PhotoUploadQueueScopeError,
  type PhotoUploadQueueStore,
} from "@/lib/photos/uploadQueue/store";
import { assertPhotoUploadTransition } from "@/lib/photos/uploadQueue/stateTransitions";
import type {
  PhotoUploadQueuePatch,
  PhotoUploadScope,
  QueuedPhotoUpload,
} from "@/lib/photos/uploadQueue/types";

export type MemoryPhotoUploadQueueDatabase = {
  items: Map<string, QueuedPhotoUpload>;
};

export function createMemoryPhotoUploadQueueDatabase(): MemoryPhotoUploadQueueDatabase {
  return { items: new Map() };
}

function belongsToScope(item: QueuedPhotoUpload, scope: PhotoUploadScope): boolean {
  return item.userId === scope.userId && item.locationId === scope.locationId;
}

export class MemoryPhotoUploadQueueStore implements PhotoUploadQueueStore {
  constructor(private readonly database: MemoryPhotoUploadQueueDatabase) {}

  async put(scope: PhotoUploadScope, item: QueuedPhotoUpload): Promise<void> {
    if (!belongsToScope(item, scope)) {
      throw new PhotoUploadQueueScopeError();
    }
    const existing = this.database.items.get(item.queueId);
    if (existing && !belongsToScope(existing, scope)) {
      throw new PhotoUploadQueueScopeError();
    }
    this.database.items.set(item.queueId, structuredClone(item));
  }

  async get(queueId: string, scope: PhotoUploadScope): Promise<QueuedPhotoUpload | null> {
    const item = this.database.items.get(queueId);
    return item && belongsToScope(item, scope) ? structuredClone(item) : null;
  }

  async list(scope: PhotoUploadScope): Promise<QueuedPhotoUpload[]> {
    return [...this.database.items.values()]
      .filter((item) => belongsToScope(item, scope))
      .map((item) => structuredClone(item));
  }

  async update(
    queueId: string,
    scope: PhotoUploadScope,
    patch: PhotoUploadQueuePatch
  ): Promise<QueuedPhotoUpload | null> {
    const item = this.database.items.get(queueId);
    if (!item || !belongsToScope(item, scope)) return null;
    if (patch.status) {
      assertPhotoUploadTransition(item.status, patch.status);
    }
    const updated = { ...item, ...patch };
    this.database.items.set(queueId, updated);
    return structuredClone(updated);
  }

  async remove(queueId: string, scope: PhotoUploadScope): Promise<void> {
    const item = this.database.items.get(queueId);
    if (item && belongsToScope(item, scope)) {
      this.database.items.delete(queueId);
    }
  }

  async recoverInterrupted(scope: PhotoUploadScope, now: number): Promise<number> {
    let recovered = 0;
    for (const [queueId, item] of this.database.items) {
      if (item.status !== "uploading" || !belongsToScope(item, scope)) continue;
      if (item.leaseExpiresAt !== null && item.leaseExpiresAt > now) continue;
      this.database.items.set(queueId, {
        ...item,
        status: "queued",
        retryAt: null,
        updatedAt: now,
        leaseOwner: null,
        leaseExpiresAt: null,
      });
      recovered += 1;
    }
    return recovered;
  }

  async tryAcquireLease(
    queueId: string,
    scope: PhotoUploadScope,
    owner: string,
    now: number,
    ttlMs: number
  ): Promise<boolean> {
    const item = this.database.items.get(queueId);
    if (!item || !belongsToScope(item, scope)) return false;
    const processable =
      item.status === "queued" ||
      item.status === "retry_wait" ||
      item.status === "uploading";
    if (!processable) return false;
    const hasLiveCompetingLease =
      item.leaseOwner !== null &&
      item.leaseOwner !== owner &&
      item.leaseExpiresAt !== null &&
      item.leaseExpiresAt > now;
    if (hasLiveCompetingLease) return false;

    this.database.items.set(queueId, {
      ...item,
      leaseOwner: owner,
      leaseExpiresAt: now + ttlMs,
    });
    return true;
  }
}
