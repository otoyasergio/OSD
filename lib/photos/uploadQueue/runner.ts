import type { PhotoUploadQueueStore } from "./store";
import type { PhotoUploadOutcome, PhotoUploadScope, QueuedPhotoUpload } from "./types";

export type PhotoUploadQueueTimer = {
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
};

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
};

type ActiveUploadClaim = {
  queueId: string;
  generation: number;
  abortController: AbortController;
  ownsClaim: boolean;
  expiresAt: number;
  renewalTimer: unknown;
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
    void this.wake();
  };
  private readonly handlePageShow = (): void => {
    void this.wake();
  };
  private readonly handleVisibilityChange = (): void => {
    if (this.options.isVisible()) void this.wake();
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

  private async drainWakeRequests(generation: number): Promise<void> {
    do {
      this.pendingWake = false;
      await this.pump(generation);
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

  private async pump(generation: number): Promise<void> {
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
        const acquired = await this.options.store.tryAcquireUploadClaim(
          item.queueId,
          this.options.scope,
          this.options.ownerId,
          this.options.now(),
          ttlMs,
          2
        );
        if (!this.canProcess(generation)) {
          if (acquired) {
            await this.options.store.releaseUploadClaim(
              item.queueId,
              this.options.scope,
              this.options.ownerId,
              this.options.now()
            );
          }
          return;
        }
        if (!acquired) continue;

        const claim: ActiveUploadClaim = {
          queueId: item.queueId,
          generation,
          abortController: new AbortController(),
          ownsClaim: true,
          expiresAt: this.options.now() + ttlMs,
          renewalTimer: null,
        };
        this.activeClaims.set(item.queueId, claim);
        const uploading = await this.options.store.updateClaimed(
          item.queueId,
          this.options.scope,
          this.options.ownerId,
          this.options.now(),
          {
            status: "uploading",
            attemptCount: item.attemptCount + 1,
            retryAt: null,
            lastError: null,
            updatedAt: this.options.now(),
          }
        );
        if (!this.canProcess(generation) || !uploading) {
          await this.releaseClaim(claim);
          this.activeClaims.delete(item.queueId);
          if (!this.canProcess(generation)) return;
          continue;
        }

        activeQueueIds.add(item.queueId);
        const uploadPromise = this.uploadOne(uploading, claim).finally(() => {
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
    this.scheduleClaimRenewal(claim, Math.floor((this.options.leaseTtlMs ?? 30_000) / 2));
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
      this.clearClaimRenewal(claim);
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

  private async renewClaim(claim: ActiveUploadClaim): Promise<void> {
    if (!claim.ownsClaim || !this.isCurrent(claim.generation)) return;
    const now = this.options.now();
    if (now >= claim.expiresAt) {
      this.loseClaim(claim);
      return;
    }
    const ttlMs = this.options.leaseTtlMs ?? 30_000;
    try {
      const renewed = await this.options.store.renewUploadClaim(
        claim.queueId,
        this.options.scope,
        this.options.ownerId,
        now,
        ttlMs
      );
      if (!this.isCurrent(claim.generation)) return;
      if (!renewed) {
        this.loseClaim(claim);
        return;
      }
      claim.expiresAt = now + ttlMs;
      this.scheduleClaimRenewal(claim, Math.floor(ttlMs / 2));
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
    this.clearClaimRenewal(claim);
    claim.abortController.abort();
  }

  private clearClaimRenewal(claim: ActiveUploadClaim): void {
    if (claim.renewalTimer === null) return;
    this.options.timer.clearTimeout(claim.renewalTimer);
    claim.renewalTimer = null;
  }

  private async releaseClaim(claim: ActiveUploadClaim): Promise<void> {
    this.clearClaimRenewal(claim);
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
        if (this.isCurrent(generation)) void this.wake();
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
