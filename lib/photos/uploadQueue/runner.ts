import type { PhotoUploadQueueStore } from "./store";
import type { PhotoUploadOutcome, PhotoUploadScope, QueuedPhotoUpload } from "./types";

export type PhotoUploadQueueTimer = {
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
};

export type PhotoUploadQueueWakeSource =
  "online" | "pageshow" | "visibilitychange" | "retry_timer";

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
  renewalTimer: unknown;
  expiryTimer: unknown;
};

export class PhotoUploadQueueRunner {
  private retryTimer: unknown = null;
  private pumpPromise: Promise<void> | null = null;
  private pendingWake = false;
  private listening = false;
  private stopped = false;
  private generation = 1;
  private readonly activeClaims = new Map<string, ActiveUploadClaim>();
  private resolveStopped: () => void = () => {};
  private readonly stoppedPromise = new Promise<void>((resolve) => {
    this.resolveStopped = resolve;
  });
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
    await this.options.store.recoverInterrupted(this.options.scope, this.options.now());
    if (!this.isCurrent(this.generation)) return;
    await this.wake();
  }

  wake(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    this.pendingWake = true;
    if (this.pumpPromise) return this.pumpPromise;
    const generation = this.generation;
    const pumping = this.drainWakeRequests(generation);
    this.pumpPromise = pumping.finally(() => {
      this.pumpPromise = null;
    });
    return this.pumpPromise;
  }

  private requestWake(source: PhotoUploadQueueWakeSource): void {
    void this.wake().catch((cause: unknown) => {
      const report = this.options.onError;
      if (!report) return;
      try {
        void Promise.resolve(
          report(new PhotoUploadQueueRunnerError(source, cause))
        ).catch(() => {
          // Error observers cannot be allowed to create an unhandled rejection.
        });
      } catch {
        // Error observers cannot be allowed to break native event callbacks.
      }
    });
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
    if (!this.canProcess(generation)) return;
    await this.options.store.recoverInterrupted(this.options.scope, this.options.now());
    if (!this.canProcess(generation)) return;
    const concurrency = Math.min(2, Math.max(1, this.options.maxConcurrency ?? 2));
    const active = new Set<Promise<void>>();
    const activeQueueIds = new Set<string>();

    while (this.canProcess(generation)) {
      const items = await this.options.store.list(this.options.scope);
      if (!this.canProcess(generation)) return;
      const now = this.options.now();
      const candidates = items.filter(
        (candidate) =>
          !activeQueueIds.has(candidate.queueId) &&
          (candidate.status === "queued" ||
            (candidate.status === "retry_wait" &&
              candidate.retryAt !== null &&
              candidate.retryAt <= now))
      );

      while (active.size < concurrency && candidates.length > 0) {
        if (!this.canProcess(generation)) return;
        const item = candidates.shift()!;
        const ttlMs = this.options.leaseTtlMs ?? 30_000;
        const acquiredClaim = await this.options.store.tryAcquireUploadClaim(
          item.queueId,
          this.options.scope,
          this.options.ownerId,
          this.options.now(),
          ttlMs,
          2,
          this.options.maxAttempts ?? 5
        );
        if (!this.canProcess(generation)) {
          if (acquiredClaim) {
            await this.options.store.releaseUploadClaim(
              item.queueId,
              this.options.scope,
              this.options.ownerId,
              this.options.now()
            );
          }
          return;
        }
        if (!acquiredClaim) continue;
        if (acquiredClaim.expiresAt <= this.options.now()) {
          await this.options.store.releaseUploadClaim(
            item.queueId,
            this.options.scope,
            this.options.ownerId,
            this.options.now()
          );
          return "released_expired_acquisition";
        }

        const claim: ActiveUploadClaim = {
          queueId: item.queueId,
          generation,
          abortController: new AbortController(),
          ownsClaim: true,
          expiresAt: acquiredClaim.expiresAt,
          renewalTimer: null,
          expiryTimer: null,
        };
        this.activeClaims.set(item.queueId, claim);
        this.scheduleClaimExpiry(claim);
        activeQueueIds.add(item.queueId);
        const uploadPromise = this.uploadOne(acquiredClaim.item, claim).finally(() => {
          active.delete(uploadPromise);
          activeQueueIds.delete(item.queueId);
          this.activeClaims.delete(item.queueId);
        });
        active.add(uploadPromise);
      }

      if (active.size === 0) {
        const remaining = await this.options.store.list(this.options.scope);
        if (!this.canProcess(generation)) return;
        this.scheduleNextRetry(remaining, generation);
        return;
      }

      await Promise.race([Promise.race(active), this.stoppedPromise]);
      if (!this.isCurrent(generation)) return;
    }
  }

  private async uploadOne(
    uploading: QueuedPhotoUpload,
    claim: ActiveUploadClaim
  ): Promise<void> {
    if (this.options.now() >= claim.expiresAt) {
      this.loseClaim(claim);
      return;
    }
    this.scheduleClaimRenewal(
      claim,
      Math.floor((claim.expiresAt - this.options.now()) / 2)
    );
    try {
      if (!this.canProcess(claim.generation) || !claim.ownsClaim) {
        await this.releaseClaim(claim);
        return;
      }

      let outcome: PhotoUploadOutcome;
      try {
        outcome = await this.options.uploader(uploading, claim.abortController.signal);
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

      if (!outcome.ok) {
        const failed =
          !outcome.retryable || uploading.attemptCount >= (this.options.maxAttempts ?? 5);
        const retryDelay = Math.min(
          (this.options.baseRetryDelayMs ?? 1_000) *
            2 ** Math.max(0, uploading.attemptCount - 1),
          this.options.maxRetryDelayMs ?? 60_000
        );
        const updated = await this.options.store.updateClaimed(
          uploading.queueId,
          this.options.scope,
          this.options.ownerId,
          this.options.now(),
          {
            status: failed ? "failed" : "retry_wait",
            retryAt: failed ? null : this.options.now() + retryDelay,
            lastError: outcome.message,
            updatedAt: this.options.now(),
          },
          true
        );
        claim.ownsClaim = false;
        if (!updated) claim.abortController.abort();
        return;
      }

      const completed = await this.options.store.completeClaimedUpload(
        uploading.queueId,
        this.options.scope,
        this.options.ownerId,
        this.options.now()
      );
      claim.ownsClaim = false;
      if (!completed) claim.abortController.abort();
    } finally {
      this.clearClaimTimers(claim);
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
          this.loseClaim(claim);
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
      this.loseClaim(claim);
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
        this.loseClaim(claim);
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
        this.loseClaim(claim);
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
        this.options.now()
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
    this.resolveStopped();
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
    const claims = [...this.activeClaims.values()];
    await Promise.all(claims.map((claim) => this.releaseClaim(claim)));
  }
}
