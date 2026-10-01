import {
  type AcquiredPhotoUploadClaim,
  DEFAULT_PHOTO_UPLOAD_MAX_ATTEMPTS,
  type PhotoUploadClaim,
  PHOTO_UPLOAD_MAX_ATTEMPTS_ERROR,
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

  async recoverInterrupted(
    scope: PhotoUploadScope,
    now: number,
    maxAttempts = DEFAULT_PHOTO_UPLOAD_MAX_ATTEMPTS
  ): Promise<number> {
    let recovered = 0;
    for (const [queueId, item] of this.database.items) {
      if (item.status !== "uploading" || !belongsToScope(item, scope)) continue;
      if (hasLivePersistedUploadClaim(item, now)) continue;
      const attemptsExhausted = item.attemptCount >= maxAttempts;
      this.database.items.set(queueId, {
        ...item,
        status: attemptsExhausted ? "failed" : "queued",
        retryAt: null,
        lastError: attemptsExhausted ? PHOTO_UPLOAD_MAX_ATTEMPTS_ERROR : item.lastError,
        updatedAt: now,
        leaseOwner: null,
        leaseExpiresAt: null,
        uploadSlotOwner: null,
        uploadSlotExpiresAt: null,
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
    return (
      (await this.tryAcquireUploadClaim(
        queueId,
        scope,
        owner,
        now,
        ttlMs,
        2,
        Number.MAX_SAFE_INTEGER
      )) !== null
    );
  }

  async tryAcquireUploadClaim(
    queueId: string,
    scope: PhotoUploadScope,
    owner: string,
    now: number,
    ttlMs: number,
    maxScopeSlots: number,
    maxAttempts: number
  ): Promise<AcquiredPhotoUploadClaim | null> {
    const item = this.database.items.get(queueId);
    if (!item || !belongsToScope(item, scope)) return null;
    const processable =
      item.status === "queued" ||
      (item.status === "retry_wait" && item.retryAt !== null && item.retryAt <= now) ||
      (item.status === "uploading" && !hasLivePersistedUploadClaim(item, now));
    if (!processable || item.attemptCount >= maxAttempts) return null;
    const hasLiveCompetingLease =
      item.leaseOwner !== null &&
      item.leaseOwner !== owner &&
      item.leaseExpiresAt !== null &&
      item.leaseExpiresAt > now;
    if (hasLiveCompetingLease) return null;
    const hasLiveCompetingSlot =
      item.uploadSlotOwner !== null &&
      item.uploadSlotOwner !== owner &&
      item.uploadSlotExpiresAt !== null &&
      item.uploadSlotExpiresAt > now;
    if (hasLiveCompetingSlot) return null;

    const alreadyOwnsLiveSlot =
      item.uploadSlotOwner === owner &&
      item.uploadSlotExpiresAt !== null &&
      item.uploadSlotExpiresAt > now;
    const slotLimit = Math.min(2, Math.max(1, maxScopeSlots));
    const activeScopeSlots = [...this.database.items.values()].filter(
      (candidate) =>
        belongsToScope(candidate, scope) &&
        candidate.uploadSlotOwner !== null &&
        candidate.uploadSlotExpiresAt !== null &&
        candidate.uploadSlotExpiresAt > now
    ).length;
    if (!alreadyOwnsLiveSlot && activeScopeSlots >= slotLimit) return null;

    const expiresAt = now + ttlMs;
    const claimedItem: QueuedPhotoUpload = {
      ...item,
      status: "uploading",
      attemptCount: item.attemptCount + 1,
      retryAt: null,
      lastError: null,
      updatedAt: now,
      leaseOwner: owner,
      leaseExpiresAt: expiresAt,
      uploadSlotOwner: owner,
      uploadSlotExpiresAt: expiresAt,
    };
    this.database.items.set(queueId, claimedItem);
    return { expiresAt, item: structuredClone(claimedItem) };
  }

  async renewUploadClaim(
    queueId: string,
    scope: PhotoUploadScope,
    owner: string,
    now: number,
    ttlMs: number
  ): Promise<PhotoUploadClaim | null> {
    const item = this.database.items.get(queueId);
    if (!item || !belongsToScope(item, scope) || !ownsLiveUploadClaim(item, owner, now)) {
      return null;
    }
    const expiresAt = now + ttlMs;
    this.database.items.set(queueId, {
      ...item,
      leaseExpiresAt: expiresAt,
      uploadSlotExpiresAt: expiresAt,
    });
    return { expiresAt };
  }

  async updateClaimed(
    queueId: string,
    scope: PhotoUploadScope,
    owner: string,
    now: number,
    patch: PhotoUploadQueuePatch,
    releaseClaim = false
  ): Promise<QueuedPhotoUpload | null> {
    const item = this.database.items.get(queueId);
    if (!item || !belongsToScope(item, scope) || !ownsLiveUploadClaim(item, owner, now)) {
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
    this.database.items.set(queueId, updated);
    return structuredClone(updated);
  }

  async completeClaimedUpload(
    queueId: string,
    scope: PhotoUploadScope,
    owner: string,
    now: number
  ): Promise<boolean> {
    const item = this.database.items.get(queueId);
    if (
      !item ||
      !belongsToScope(item, scope) ||
      item.status !== "uploading" ||
      !ownsLiveUploadClaim(item, owner, now)
    ) {
      return false;
    }
    assertPhotoUploadTransition(item.status, "saved");
    this.database.items.delete(queueId);
    return true;
  }

  async releaseUploadClaim(
    queueId: string,
    scope: PhotoUploadScope,
    owner: string,
    now: number,
    maxAttempts = DEFAULT_PHOTO_UPLOAD_MAX_ATTEMPTS
  ): Promise<boolean> {
    const item = this.database.items.get(queueId);
    if (!item || !belongsToScope(item, scope)) return false;
    const ownsLease = item.leaseOwner === owner;
    const ownsSlot = item.uploadSlotOwner === owner;
    if (!ownsLease && !ownsSlot) return false;
    const recoverUpload = item.status === "uploading" && ownsLease && ownsSlot;
    const attemptsExhausted = recoverUpload && item.attemptCount >= maxAttempts;
    this.database.items.set(queueId, {
      ...item,
      status: recoverUpload ? (attemptsExhausted ? "failed" : "queued") : item.status,
      retryAt: recoverUpload ? null : item.retryAt,
      lastError: attemptsExhausted ? PHOTO_UPLOAD_MAX_ATTEMPTS_ERROR : item.lastError,
      updatedAt: now,
      leaseOwner: ownsLease ? null : item.leaseOwner,
      leaseExpiresAt: ownsLease ? null : item.leaseExpiresAt,
      uploadSlotOwner: ownsSlot ? null : item.uploadSlotOwner,
      uploadSlotExpiresAt: ownsSlot ? null : item.uploadSlotExpiresAt,
    });
    return true;
  }
}
