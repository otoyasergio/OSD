import {
  type AcquiredPhotoUploadClaim,
  DEFAULT_PHOTO_UPLOAD_MAX_ATTEMPTS,
  type PhotoUploadFailureSettlement,
  type PhotoUploadQueueStore,
} from "./store";
import type { PhotoUploadOutcome, PhotoUploadScope, QueuedPhotoUpload } from "./types";

export type PhotoUploadQueueTimer = {
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
};

export type PhotoUploadQueueWakeSource =
  | "online"
  | "pageshow"
  | "visibilitychange"
  | "retry_timer"
  | "claim_expiry"
  | "upload_settlement";

export class PhotoUploadQueueRunnerError extends Error {
  readonly name = "PhotoUploadQueueRunnerError";

  constructor(
    readonly source: PhotoUploadQueueWakeSource,
    cause: unknown
  ) {
    super(`Photo upload queue wake failed after ${source}.`, { cause });
  }
}

export type PhotoUploadQueueRunnerOptions = {
  scope: PhotoUploadScope;
  store: PhotoUploadQueueStore;
  uploader(item: QueuedPhotoUpload, signal: AbortSignal): Promise<PhotoUploadOutcome>;
  now(): number;
  timer: PhotoUploadQueueTimer;
  isOnline(): boolean;
  isVisible(): boolean;
  eventTarget: Pick<EventTarget, "addEventListener" | "removeEventListener">;
  ownerId: string;
  maxConcurrency?: number;
  leaseTtlMs?: number;
  baseRetryDelayMs?: number;
  maxRetryDelayMs?: number;
  maxAttempts?: number;
  onError?(error: PhotoUploadQueueRunnerError): void | Promise<void>;
};

type ActiveUploadClaim = {
  queueId: string;
  generation: number;
  abortController: AbortController;
  ownsClaim: boolean;
  expiresAt: number;
  acquisition: AcquiredPhotoUploadClaim;
  uploaderStarted: boolean;
  renewalTimer: unknown;
  expiryTimer: unknown;
};

type ActiveUpload = {
  claim: ActiveUploadClaim;
  promise: Promise<void>;
};

export class PhotoUploadQueueRunner {
  private retryTimer: unknown = null;
  private pumpPromise: Promise<void> | null = null;
  private pendingWake = false;
  private listening = false;
  private stopped = false;
  private generation = 1;
  private readonly activeUploads = new Map<string, ActiveUpload>();
  private readonly handleOnline = (): void => {
    this.requestWake("online");
  };
  private readonly handlePageShow = (): void => {
    this.requestWake("pageshow");
  };
  private readonly handleVisibilityChange = (): void => {
    if (this.options.isVisible()) this.requestWake("visibilitychange");
  };

  constructor(private readonly options: PhotoUploadQueueRunnerOptions) {}

  private get maxAttempts(): number {
    return this.options.maxAttempts ?? DEFAULT_PHOTO_UPLOAD_MAX_ATTEMPTS;
  }

  /**
   * Resolves after the initial scheduler pass. Uploads started by that pass
   * remain owned and tracked by the runner until they settle or stop() aborts them.
   */
  async start(): Promise<void> {
    if (this.stopped) return;
    if (!this.listening) {
      this.options.eventTarget.addEventListener("online", this.handleOnline);
      this.options.eventTarget.addEventListener("pageshow", this.handlePageShow);
      this.options.eventTarget.addEventListener(
        "visibilitychange",
        this.handleVisibilityChange
      );
      this.listening = true;
    }
    await this.wake();
  }

  /**
   * Coalesces and awaits scheduler work; it does not await active upload bodies.
   */
  wake(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    this.pendingWake = true;
    if (this.pumpPromise) return this.pumpPromise;
    const generation = this.generation;
    const pumping = this.drainWakeRequests(generation);
    this.pumpPromise = pumping;
    void pumping.then(
      () => this.finishPump(pumping, generation),
      () => this.finishPump(pumping, generation)
    );
    return pumping;
  }

  private finishPump(pumping: Promise<void>, generation: number): void {
    if (this.pumpPromise !== pumping) return;
    this.pumpPromise = null;
    if (this.pendingWake && this.isCurrent(generation)) {
      this.requestWake("upload_settlement");
    }
  }

  private requestWake(source: PhotoUploadQueueWakeSource): void {
    void this.wake().catch((cause: unknown) => {
      this.reportError(source, cause);
    });
  }

  private reportError(source: PhotoUploadQueueWakeSource, cause: unknown): void {
    const report = this.options.onError;
    if (!report) return;
    try {
      void Promise.resolve(report(new PhotoUploadQueueRunnerError(source, cause))).catch(
        () => {
          // Error observers cannot be allowed to create an unhandled rejection.
        }
      );
    } catch {
      // Error observers cannot be allowed to break scheduler callbacks.
    }
  }

  private async drainWakeRequests(generation: number): Promise<void> {
    let retriedExpiredAcquisition = false;
    do {
      this.pendingWake = false;
      const pumpResult = await this.pump(generation);
      if (pumpResult === "released_expired_acquisition" && !retriedExpiredAcquisition) {
        retriedExpiredAcquisition = true;
        this.pendingWake = true;
      }
      await Promise.resolve();
    } while (this.pendingWake && this.isCurrent(generation));
  }

  private isCurrent(generation: number): boolean {
    return !this.stopped && this.generation === generation;
  }

  private canProcess(generation: number): boolean {
    return (
      this.isCurrent(generation) && this.options.isOnline() && this.options.isVisible()
    );
  }

  private async pump(generation: number): Promise<"released_expired_acquisition" | void> {
    this.clearRetryTimer();
    if (!this.isCurrent(generation)) return;
    await this.options.store.recoverInterrupted(
      this.options.scope,
      this.options.now(),
      this.maxAttempts
    );
    if (!this.canProcess(generation)) return;
    const concurrency = Math.min(2, Math.max(1, this.options.maxConcurrency ?? 2));
    const items = await this.options.store.list(this.options.scope);
    if (!this.canProcess(generation)) return;
    const now = this.options.now();
    const candidates = items.filter(
      (candidate) =>
        !this.activeUploads.has(candidate.queueId) &&
        (candidate.status === "queued" ||
          (candidate.status === "retry_wait" &&
            candidate.retryAt !== null &&
            candidate.retryAt <= now))
    );
    let releasedExpiredAcquisition = false;

    while (
      this.activeUploads.size < concurrency &&
      candidates.length > 0 &&
      this.canProcess(generation)
    ) {
      const item = candidates.shift()!;
      if (this.activeUploads.has(item.queueId)) continue;
      const ttlMs = this.options.leaseTtlMs ?? 30_000;
      const acquiredClaim = await this.options.store.tryAcquireUploadClaim(
        item.queueId,
        this.options.scope,
        this.options.ownerId,
        this.options.now(),
        ttlMs,
        2,
        this.maxAttempts
      );
      if (!acquiredClaim) {
        if (!this.canProcess(generation)) {
          return releasedExpiredAcquisition ? "released_expired_acquisition" : undefined;
        }
        continue;
      }
      const claim: ActiveUploadClaim = {
        queueId: item.queueId,
        generation,
        abortController: new AbortController(),
        ownsClaim: true,
        expiresAt: acquiredClaim.expiresAt,
        acquisition: acquiredClaim,
        uploaderStarted: false,
        renewalTimer: null,
        expiryTimer: null,
      };
      if (!this.canProcess(generation)) {
        await this.releaseUnstartedClaim(claim);
        return releasedExpiredAcquisition ? "released_expired_acquisition" : undefined;
      }
      if (acquiredClaim.expiresAt <= this.options.now()) {
        await this.releaseUnstartedClaim(claim);
        releasedExpiredAcquisition = true;
        continue;
      }

      this.startTrackedUpload(acquiredClaim.item, claim);
    }

    const remaining = await this.options.store.list(this.options.scope);
    if (this.canProcess(generation)) {
      this.scheduleNextRetry(remaining, generation);
    }
    return releasedExpiredAcquisition ? "released_expired_acquisition" : undefined;
  }

  private startTrackedUpload(
    uploading: QueuedPhotoUpload,
    claim: ActiveUploadClaim
  ): void {
    const active: ActiveUpload = {
      claim,
      promise: Promise.resolve(),
    };
    this.activeUploads.set(uploading.queueId, active);
    this.scheduleClaimExpiry(claim);
    const promise = this.uploadOne(uploading, claim)
      .catch(async (cause: unknown) => {
        this.reportError("upload_settlement", cause);
        if (claim.uploaderStarted) {
          await this.releaseClaim(claim);
        } else {
          await this.releaseUnstartedClaim(claim);
        }
      })
      .finally(() => {
        if (this.activeUploads.get(uploading.queueId)?.promise === promise) {
          this.activeUploads.delete(uploading.queueId);
        }
        this.requestWake("upload_settlement");
      });
    active.promise = promise;
  }

  private async uploadOne(
    uploading: QueuedPhotoUpload,
    claim: ActiveUploadClaim
  ): Promise<void> {
    if (this.options.now() >= claim.expiresAt) {
      await this.releaseUnstartedClaim(claim);
      return;
    }
    try {
      if (!this.canProcess(claim.generation) || !claim.ownsClaim) {
        await this.releaseUnstartedClaim(claim);
        return;
      }
      this.scheduleClaimRenewal(
        claim,
        Math.floor((claim.expiresAt - this.options.now()) / 2)
      );

      let outcome: PhotoUploadOutcome;
      try {
        claim.uploaderStarted = true;
        const uploaded = await this.invokeUploader(uploading, claim);
        if (uploaded === null) return;
        outcome = uploaded;
      } catch (error) {
        if (
          claim.abortController.signal.aborted ||
          !claim.ownsClaim ||
          !this.isCurrent(claim.generation)
        ) {
          return;
        }
        outcome = {
          ok: false,
          retryable: true,
          message:
            error instanceof Error && error.message
              ? error.message
              : "The photo upload was interrupted.",
        };
      }
      if (!claim.ownsClaim || !this.isCurrent(claim.generation)) return;
      if (this.options.now() >= claim.expiresAt) {
        this.expireClaim(claim);
        return;
      }

      if (!outcome.ok) {
        const failed = !outcome.retryable || uploading.attemptCount >= this.maxAttempts;
        const retryDelay = Math.min(
          (this.options.baseRetryDelayMs ?? 1_000) *
            2 ** Math.max(0, uploading.attemptCount - 1),
          this.options.maxRetryDelayMs ?? 60_000
        );
        const settlementNow = this.options.now();
        const settlement: PhotoUploadFailureSettlement = {
          status: failed ? "failed" : "retry_wait",
          retryAt: failed ? null : settlementNow + retryDelay,
          lastError: outcome.message,
          updatedAt: settlementNow,
        };
        await this.persistFailedOutcome(uploading, claim, settlement);
        return;
      }

      const completed = await this.options.store.completeClaimedUpload(
        uploading.queueId,
        this.options.scope,
        this.options.ownerId,
        this.options.now()
      );
      if (completed) {
        claim.ownsClaim = false;
      } else {
        this.recoverLostClaim(claim);
      }
    } finally {
      this.clearClaimTimers(claim);
    }
  }

  private async invokeUploader(
    uploading: QueuedPhotoUpload,
    claim: ActiveUploadClaim
  ): Promise<PhotoUploadOutcome | null> {
    const signal = claim.abortController.signal;
    let handleAbort = (): void => {};
    const aborted = new Promise<null>((resolve) => {
      handleAbort = () => resolve(null);
      signal.addEventListener("abort", handleAbort, { once: true });
      if (signal.aborted) handleAbort();
    });
    try {
      return await Promise.race([this.options.uploader(uploading, signal), aborted]);
    } finally {
      signal.removeEventListener("abort", handleAbort);
    }
  }

  private scheduleClaimRenewal(claim: ActiveUploadClaim, delayMs: number): void {
    if (!claim.ownsClaim || !this.isCurrent(claim.generation)) return;
    this.clearClaimRenewal(claim);
    claim.renewalTimer = this.options.timer.setTimeout(
      () => {
        claim.renewalTimer = null;
        void this.renewClaim(claim);
      },
      Math.max(1, delayMs)
    );
  }

  private scheduleClaimExpiry(claim: ActiveUploadClaim): void {
    if (!claim.ownsClaim || !this.isCurrent(claim.generation)) return;
    if (claim.expiryTimer !== null) {
      this.options.timer.clearTimeout(claim.expiryTimer);
    }
    claim.expiryTimer = this.options.timer.setTimeout(
      () => {
        claim.expiryTimer = null;
        if (!claim.ownsClaim || !this.isCurrent(claim.generation)) return;
        if (this.options.now() >= claim.expiresAt) {
          this.expireClaim(claim);
        } else {
          this.scheduleClaimExpiry(claim);
        }
      },
      Math.max(0, claim.expiresAt - this.options.now())
    );
  }

  private async renewClaim(claim: ActiveUploadClaim): Promise<void> {
    if (!claim.ownsClaim || !this.isCurrent(claim.generation)) return;
    const now = this.options.now();
    if (now >= claim.expiresAt) {
      this.expireClaim(claim);
      return;
    }
    const ttlMs = this.options.leaseTtlMs ?? 30_000;
    try {
      const renewedClaim = await this.options.store.renewUploadClaim(
        claim.queueId,
        this.options.scope,
        this.options.ownerId,
        now,
        ttlMs
      );
      if (!this.isCurrent(claim.generation) || !claim.ownsClaim) return;
      if (!renewedClaim) {
        this.loseClaim(claim);
        return;
      }
      claim.expiresAt = renewedClaim.expiresAt;
      if (claim.expiresAt <= this.options.now()) {
        this.expireClaim(claim);
        return;
      }
      this.scheduleClaimExpiry(claim);
      this.scheduleClaimRenewal(
        claim,
        Math.floor((claim.expiresAt - this.options.now()) / 2)
      );
    } catch {
      if (!this.isCurrent(claim.generation) || !claim.ownsClaim) return;
      const remainingMs = claim.expiresAt - this.options.now();
      if (remainingMs <= 0) {
        this.expireClaim(claim);
        return;
      }
      this.scheduleClaimRenewal(
        claim,
        Math.min(
          Math.max(1, Math.floor(ttlMs / 4)),
          Math.max(1, Math.floor(remainingMs / 2))
        )
      );
    }
  }

  private expireClaim(claim: ActiveUploadClaim): void {
    this.loseClaim(claim);
    this.requestWake("claim_expiry");
  }

  private recoverLostClaim(claim: ActiveUploadClaim): void {
    this.loseClaim(claim);
    this.requestWake("upload_settlement");
  }

  private loseClaim(claim: ActiveUploadClaim): void {
    claim.ownsClaim = false;
    this.clearClaimTimers(claim);
    claim.abortController.abort();
  }

  private clearClaimRenewal(claim: ActiveUploadClaim): void {
    if (claim.renewalTimer === null) return;
    this.options.timer.clearTimeout(claim.renewalTimer);
    claim.renewalTimer = null;
  }

  private clearClaimTimers(claim: ActiveUploadClaim): void {
    this.clearClaimRenewal(claim);
    if (claim.expiryTimer === null) return;
    this.options.timer.clearTimeout(claim.expiryTimer);
    claim.expiryTimer = null;
  }

  private async persistFailedOutcome(
    uploading: QueuedPhotoUpload,
    claim: ActiveUploadClaim,
    settlement: PhotoUploadFailureSettlement
  ): Promise<void> {
    try {
      const updated = await this.options.store.updateClaimed(
        uploading.queueId,
        this.options.scope,
        this.options.ownerId,
        this.options.now(),
        settlement,
        true
      );
      if (updated) {
        claim.ownsClaim = false;
      } else {
        this.recoverLostClaim(claim);
      }
      return;
    } catch {
      // Retry the known outcome through the dedicated atomic fallback below.
    }

    try {
      const settled = await this.options.store.settleClaimedFailure(
        uploading.queueId,
        this.options.scope,
        this.options.ownerId,
        this.options.now(),
        settlement
      );
      if (settled) {
        claim.ownsClaim = false;
      } else {
        this.recoverLostClaim(claim);
      }
    } catch (cause) {
      this.reportError("upload_settlement", cause);
      this.recoverLostClaim(claim);
    }
  }

  private async releaseUnstartedClaim(claim: ActiveUploadClaim): Promise<void> {
    this.clearClaimTimers(claim);
    claim.abortController.abort();
    if (!claim.ownsClaim) return;
    claim.ownsClaim = false;
    try {
      const released = await this.options.store.releaseUnstartedUploadClaim(
        claim.queueId,
        this.options.scope,
        this.options.ownerId,
        this.options.now(),
        claim.acquisition
      );
      if (!released) this.recoverLostClaim(claim);
    } catch (cause) {
      this.reportError("upload_settlement", cause);
      this.recoverLostClaim(claim);
    }
  }

  private async releaseClaim(claim: ActiveUploadClaim): Promise<void> {
    this.clearClaimTimers(claim);
    claim.abortController.abort();
    if (!claim.ownsClaim) return;
    claim.ownsClaim = false;
    try {
      await this.options.store.releaseUploadClaim(
        claim.queueId,
        this.options.scope,
        this.options.ownerId,
        this.options.now(),
        this.maxAttempts
      );
    } catch {
      // The expiring persisted claim remains recoverable after storage returns.
    }
  }

  private scheduleNextRetry(items: QueuedPhotoUpload[], generation: number): void {
    if (!this.isCurrent(generation)) return;
    const now = this.options.now();
    const wakeAt = items.reduce<number | null>((earliest, item) => {
      const liveSlotExpiresAt =
        item.uploadSlotOwner !== null &&
        item.uploadSlotExpiresAt !== null &&
        item.uploadSlotExpiresAt > now
          ? item.uploadSlotExpiresAt
          : null;
      const liveLeaseExpiresAt =
        item.leaseOwner !== null &&
        item.leaseExpiresAt !== null &&
        item.leaseExpiresAt > now
          ? item.leaseExpiresAt
          : null;
      const liveClaimExpiresAt =
        liveSlotExpiresAt === null
          ? liveLeaseExpiresAt
          : liveLeaseExpiresAt === null
            ? liveSlotExpiresAt
            : Math.min(liveSlotExpiresAt, liveLeaseExpiresAt);
      const pendingRetryAt =
        item.status === "retry_wait" && item.retryAt !== null && item.retryAt > now
          ? item.retryAt
          : null;
      const itemWakeAt = liveClaimExpiresAt ?? pendingRetryAt;
      if (itemWakeAt === null) return earliest;
      return earliest === null ? itemWakeAt : Math.min(earliest, itemWakeAt);
    }, null);
    if (wakeAt !== null) this.scheduleRetry(wakeAt, generation);
  }

  private scheduleRetry(retryAt: number, generation: number): void {
    if (!this.isCurrent(generation)) return;
    this.clearRetryTimer();
    this.retryTimer = this.options.timer.setTimeout(
      () => {
        this.retryTimer = null;
        if (this.isCurrent(generation)) this.requestWake("retry_timer");
      },
      Math.max(0, retryAt - this.options.now())
    );
  }

  private clearRetryTimer(): void {
    if (this.retryTimer === null) return;
    this.options.timer.clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    this.generation += 1;
    this.pendingWake = false;
    this.clearRetryTimer();
    if (this.listening) {
      this.options.eventTarget.removeEventListener("online", this.handleOnline);
      this.options.eventTarget.removeEventListener("pageshow", this.handlePageShow);
      this.options.eventTarget.removeEventListener(
        "visibilitychange",
        this.handleVisibilityChange
      );
      this.listening = false;
    }
    const scheduler = this.pumpPromise;
    const active = [...this.activeUploads.values()];
    await Promise.all(
      active.map(({ claim }) =>
        claim.uploaderStarted
          ? this.releaseClaim(claim)
          : this.releaseUnstartedClaim(claim)
      )
    );
    await Promise.allSettled(active.map(({ promise }) => promise));
    if (scheduler) {
      void scheduler.catch(() => {
        // A stopped runner deliberately consumes unfinished scheduler failures.
      });
    }
  }
}
