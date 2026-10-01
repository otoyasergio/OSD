import {
  type AcquiredPhotoUploadClaim,
  createPhotoUploadConfirmationReceipt,
  createPhotoUploadFailureSettlement,
  DEFAULT_PHOTO_UPLOAD_MAX_ATTEMPTS,
  type PhotoUploadClaim,
  type PhotoUploadFailureOutcome,
  type PhotoUploadRetryPolicy,
  PHOTO_UPLOAD_MAX_ATTEMPTS_ERROR,
  attachQueuedPhotoToWorkOrder,
  createManualRetryState,
  PhotoUploadQueueScopeError,
  type PhotoUploadQueueStore,
} from "@/lib/photos/uploadQueue/store";
import { assertPhotoUploadTransition } from "@/lib/photos/uploadQueue/stateTransitions";
import type {
  PhotoUploadConfirmationInput,
  PhotoUploadConfirmationReceipt,
  PhotoUploadQueuePatch,
  PhotoUploadScope,
  QueuedPhotoUpload,
} from "@/lib/photos/uploadQueue/types";

export type MemoryPhotoUploadQueueDatabase = {
  items: Map<string, QueuedPhotoUpload>;
  confirmations: Map<string, PhotoUploadConfirmationReceipt>;
};

export function createMemoryPhotoUploadQueueDatabase(): MemoryPhotoUploadQueueDatabase {
  return { items: new Map(), confirmations: new Map() };
}

function belongsToScope(item: QueuedPhotoUpload, scope: PhotoUploadScope): boolean {
  return item.userId === scope.userId && item.locationId === scope.locationId;
}

function cloneQueuedPhoto(item: QueuedPhotoUpload): QueuedPhotoUpload {
  const { blob, ...rest } = item;
  const cloned = structuredClone(rest) as Omit<QueuedPhotoUpload, "blob">;
  const nextBlob =
    blob instanceof Blob ? new Blob([blob], { type: item.mimeType || blob.type }) : blob;
  return { ...cloned, blob: nextBlob } as QueuedPhotoUpload;
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
    this.database.items.set(item.queueId, cloneQueuedPhoto(item));
  }

  async get(queueId: string, scope: PhotoUploadScope): Promise<QueuedPhotoUpload | null> {
    const item = this.database.items.get(queueId);
    return item && belongsToScope(item, scope) ? cloneQueuedPhoto(item) : null;
  }

  async list(scope: PhotoUploadScope): Promise<QueuedPhotoUpload[]> {
    return [...this.database.items.values()]
      .filter((item) => belongsToScope(item, scope))
      .map((item) => cloneQueuedPhoto(item));
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
    return cloneQueuedPhoto(updated);
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

    const priorEligibility = {
      status: item.status,
      retryAt: item.retryAt,
      lastError: item.lastError,
    };
    const expiresAt = now + ttlMs;
    const claimedItem: QueuedPhotoUpload = {
      ...item,
      status: "uploading",
      retryAt: null,
      lastError: null,
      updatedAt: now,
      leaseOwner: owner,
      leaseExpiresAt: expiresAt,
      uploadSlotOwner: owner,
      uploadSlotExpiresAt: expiresAt,
    };
    this.database.items.set(queueId, claimedItem);
    return {
      expiresAt,
      item: cloneQueuedPhoto(claimedItem),
      priorEligibility,
    };
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

  async releaseUnstartedUploadClaim(
    queueId: string,
    scope: PhotoUploadScope,
    owner: string,
    now: number,
    claim: AcquiredPhotoUploadClaim
  ): Promise<boolean> {
    const item = this.database.items.get(queueId);
    if (
      !item ||
      !belongsToScope(item, scope) ||
      item.status !== "uploading" ||
      item.leaseOwner !== owner ||
      item.leaseExpiresAt !== claim.expiresAt ||
      item.uploadSlotOwner !== owner ||
      item.uploadSlotExpiresAt !== claim.expiresAt ||
      item.attemptCount !== claim.item.attemptCount ||
      claim.item.queueId !== queueId ||
      !belongsToScope(claim.item, scope) ||
      claim.item.leaseOwner !== owner ||
      claim.item.leaseExpiresAt !== claim.expiresAt ||
      claim.item.uploadSlotOwner !== owner ||
      claim.item.uploadSlotExpiresAt !== claim.expiresAt
    ) {
      return false;
    }
    this.database.items.set(queueId, {
      ...item,
      ...claim.priorEligibility,
      updatedAt: now,
      leaseOwner: null,
      leaseExpiresAt: null,
      uploadSlotOwner: null,
      uploadSlotExpiresAt: null,
    });
    return true;
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
    return cloneQueuedPhoto(updated);
  }

  async settleClaimedFailure(
    queueId: string,
    scope: PhotoUploadScope,
    owner: string,
    now: number,
    outcome: PhotoUploadFailureOutcome,
    policy: PhotoUploadRetryPolicy
  ): Promise<QueuedPhotoUpload | null> {
    const item = this.database.items.get(queueId);
    if (
      !item ||
      !belongsToScope(item, scope) ||
      item.status !== "uploading" ||
      !ownsLiveUploadClaim(item, owner, now)
    ) {
      return null;
    }
    const settlement = createPhotoUploadFailureSettlement(
      item.attemptCount,
      outcome,
      now,
      policy
    );
    assertPhotoUploadTransition(item.status, settlement.status);
    const updated: QueuedPhotoUpload = {
      ...item,
      ...settlement,
      leaseOwner: null,
      leaseExpiresAt: null,
      uploadSlotOwner: null,
      uploadSlotExpiresAt: null,
    };
    this.database.items.set(queueId, updated);
    return cloneQueuedPhoto(updated);
  }

  async completeClaimedUpload(
    queueId: string,
    scope: PhotoUploadScope,
    owner: string,
    now: number,
    confirmation: PhotoUploadConfirmationInput
  ): Promise<boolean> {
    const item = this.database.items.get(queueId);
    if (
      !item ||
      !belongsToScope(item, scope) ||
      item.status !== "uploading" ||
      !ownsLiveUploadClaim(item, owner, now) ||
      confirmation.clientUploadId !== item.clientUploadId
    ) {
      return false;
    }
    assertPhotoUploadTransition(item.status, "saved");
    this.database.confirmations.set(
      queueId,
      createPhotoUploadConfirmationReceipt(item, confirmation, now)
    );
    this.database.items.delete(queueId);
    return true;
  }

  async listConfirmations(
    scope: PhotoUploadScope
  ): Promise<PhotoUploadConfirmationReceipt[]> {
    return [...this.database.confirmations.values()]
      .filter(
        (receipt) =>
          receipt.userId === scope.userId && receipt.locationId === scope.locationId
      )
      .map((receipt) => ({ ...receipt }));
  }

  async getConfirmation(
    queueId: string,
    scope: PhotoUploadScope
  ): Promise<PhotoUploadConfirmationReceipt | null> {
    const receipt = this.database.confirmations.get(queueId);
    if (
      !receipt ||
      receipt.userId !== scope.userId ||
      receipt.locationId !== scope.locationId
    ) {
      return null;
    }
    return { ...receipt };
  }

  async pruneConfirmations(scope: PhotoUploadScope, olderThan: number): Promise<number> {
    let removed = 0;
    for (const [queueId, receipt] of [...this.database.confirmations]) {
      if (
        receipt.userId === scope.userId &&
        receipt.locationId === scope.locationId &&
        receipt.confirmedAt < olderThan
      ) {
        this.database.confirmations.delete(queueId);
        removed += 1;
      }
    }
    return removed;
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

  async attachDraftToWorkOrder(
    scope: PhotoUploadScope,
    intakeDraftId: string,
    workOrderId: string,
    now: number
  ): Promise<QueuedPhotoUpload[]> {
    const attached: QueuedPhotoUpload[] = [];
    for (const [queueId, item] of this.database.items) {
      if (!belongsToScope(item, scope) || item.intakeDraftId !== intakeDraftId) {
        continue;
      }
      const next = attachQueuedPhotoToWorkOrder(item, workOrderId, now);
      this.database.items.set(queueId, next);
      attached.push(cloneQueuedPhoto(next));
    }
    return attached;
  }

  async retryFailed(
    queueId: string,
    scope: PhotoUploadScope,
    now: number
  ): Promise<QueuedPhotoUpload | null> {
    const item = this.database.items.get(queueId);
    if (!item || !belongsToScope(item, scope) || item.status !== "failed") {
      return null;
    }
    const retried = createManualRetryState(item, now);
    this.database.items.set(queueId, retried);
    return cloneQueuedPhoto(retried);
  }

  async removeUnclaimed(
    queueId: string,
    scope: PhotoUploadScope,
    now: number
  ): Promise<boolean> {
    const item = this.database.items.get(queueId);
    if (!item || !belongsToScope(item, scope) || hasLivePersistedUploadClaim(item, now)) {
      return false;
    }
    this.database.items.delete(queueId);
    return true;
  }

  async replaceDraftCategory(
    scope: PhotoUploadScope,
    intakeDraftId: string,
    category: string,
    item: QueuedPhotoUpload,
    now: number
  ): Promise<QueuedPhotoUpload> {
    if (!belongsToScope(item, scope) || item.intakeDraftId !== intakeDraftId) {
      throw new PhotoUploadQueueScopeError();
    }
    for (const [queueId, existing] of [...this.database.items]) {
      if (
        !belongsToScope(existing, scope) ||
        existing.intakeDraftId !== intakeDraftId ||
        existing.category !== category
      ) {
        continue;
      }
      if (hasLivePersistedUploadClaim(existing, now)) continue;
      this.database.items.delete(queueId);
    }
    const queued: QueuedPhotoUpload = {
      ...item,
      category,
      intakeDraftId,
      updatedAt: now,
    };
    this.database.items.set(item.queueId, queued);
    return cloneQueuedPhoto(queued);
  }
}
