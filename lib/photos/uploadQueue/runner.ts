import type { PhotoUploadQueueStore } from "./store";
import type { PhotoUploadOutcome, PhotoUploadScope, QueuedPhotoUpload } from "./types";

export type PhotoUploadQueueTimer = {
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
};

export type PhotoUploadQueueRunnerOptions = {
  scope: PhotoUploadScope;
  store: PhotoUploadQueueStore;
  uploader(item: QueuedPhotoUpload): Promise<PhotoUploadOutcome>;
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

export class PhotoUploadQueueRunner {
  private retryTimer: unknown = null;
  private pumpPromise: Promise<void> | null = null;
  private listening = false;
  private readonly stopLeaseRenewals = new Set<() => void>();
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
    await this.wake();
  }

  wake(): Promise<void> {
    if (this.pumpPromise) return this.pumpPromise;
    const pumping = this.pump();
    this.pumpPromise = pumping.finally(() => {
      this.pumpPromise = null;
    });
    return this.pumpPromise;
  }

  private async pump(): Promise<void> {
    this.clearRetryTimer();
    if (!this.options.isOnline() || !this.options.isVisible()) return;
    await this.options.store.recoverInterrupted(this.options.scope, this.options.now());
    const concurrency = Math.min(2, Math.max(1, this.options.maxConcurrency ?? 2));
    const active = new Set<Promise<void>>();
    const activeQueueIds = new Set<string>();

    while (this.options.isOnline() && this.options.isVisible()) {
      const items = await this.options.store.list(this.options.scope);
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
        const item = candidates.shift()!;
        const acquired = await this.options.store.tryAcquireLease(
          item.queueId,
          this.options.scope,
          this.options.ownerId,
          this.options.now(),
          this.options.leaseTtlMs ?? 30_000
        );
        if (!acquired) continue;
        const uploading = await this.options.store.update(
          item.queueId,
          this.options.scope,
          {
            status: "uploading",
            attemptCount: item.attemptCount + 1,
            retryAt: null,
            lastError: null,
            updatedAt: this.options.now(),
          }
        );
        if (!uploading) continue;

        activeQueueIds.add(item.queueId);
        const uploadPromise = this.uploadOne(uploading).finally(() => {
          active.delete(uploadPromise);
          activeQueueIds.delete(item.queueId);
        });
        active.add(uploadPromise);
      }

      if (active.size === 0) {
        this.scheduleNextRetry(await this.options.store.list(this.options.scope));
        return;
      }

      await Promise.race(active);
    }

    await Promise.all(active);
  }

  private async uploadOne(uploading: QueuedPhotoUpload): Promise<void> {
    const stopRenewingLease = this.startLeaseRenewal(uploading.queueId);
    try {
      let outcome: PhotoUploadOutcome;
      try {
        outcome = await this.options.uploader(uploading);
      } catch (error) {
        outcome = {
          ok: false,
          retryable: true,
          message:
            error instanceof Error && error.message
              ? error.message
              : "The photo upload was interrupted.",
        };
      }
      if (!outcome.ok) {
        if (
          !outcome.retryable ||
          uploading.attemptCount >= (this.options.maxAttempts ?? 5)
        ) {
          await this.options.store.update(uploading.queueId, this.options.scope, {
            status: "failed",
            retryAt: null,
            lastError: outcome.message,
            updatedAt: this.options.now(),
            leaseOwner: null,
            leaseExpiresAt: null,
          });
          return;
        }
        const retryDelay = Math.min(
          (this.options.baseRetryDelayMs ?? 1_000) *
            2 ** Math.max(0, uploading.attemptCount - 1),
          this.options.maxRetryDelayMs ?? 60_000
        );
        const retryAt = this.options.now() + retryDelay;
        await this.options.store.update(uploading.queueId, this.options.scope, {
          status: "retry_wait",
          retryAt,
          lastError: outcome.message,
          updatedAt: this.options.now(),
          leaseOwner: null,
          leaseExpiresAt: null,
        });
        return;
      }

      await this.options.store.update(uploading.queueId, this.options.scope, {
        status: "saved",
        updatedAt: this.options.now(),
        leaseOwner: null,
        leaseExpiresAt: null,
      });
      await this.options.store.remove(uploading.queueId, this.options.scope);
    } finally {
      stopRenewingLease();
    }
  }

  private startLeaseRenewal(queueId: string): () => void {
    const ttlMs = this.options.leaseTtlMs ?? 30_000;
    let stopped = false;
    let timerHandle: unknown = null;

    const schedule = (): void => {
      timerHandle = this.options.timer.setTimeout(
        () => {
          timerHandle = null;
          void renew();
        },
        Math.max(1, Math.floor(ttlMs / 2))
      );
    };
    const renew = async (): Promise<void> => {
      if (stopped) return;
      try {
        const renewed = await this.options.store.tryAcquireLease(
          queueId,
          this.options.scope,
          this.options.ownerId,
          this.options.now(),
          ttlMs
        );
        if (renewed && !stopped) schedule();
      } catch {
        // The active upload still settles its queue item. A later hydration can
        // recover it if storage remains unavailable long enough for the lease
        // to expire.
      }
    };
    const stop = (): void => {
      if (stopped) return;
      stopped = true;
      if (timerHandle !== null) {
        this.options.timer.clearTimeout(timerHandle);
        timerHandle = null;
      }
      this.stopLeaseRenewals.delete(stop);
    };

    this.stopLeaseRenewals.add(stop);
    schedule();
    return stop;
  }

  private scheduleNextRetry(items: QueuedPhotoUpload[]): void {
    const now = this.options.now();
    const wakeAt = items.reduce<number | null>((earliest, item) => {
      const liveLeaseExpiresAt =
        item.leaseOwner !== null &&
        item.leaseExpiresAt !== null &&
        item.leaseExpiresAt > now
          ? item.leaseExpiresAt
          : null;
      const pendingRetryAt =
        item.status === "retry_wait" && item.retryAt !== null && item.retryAt > now
          ? item.retryAt
          : null;
      const itemWakeAt = liveLeaseExpiresAt ?? pendingRetryAt;
      if (itemWakeAt === null) return earliest;
      return earliest === null ? itemWakeAt : Math.min(earliest, itemWakeAt);
    }, null);
    if (wakeAt !== null) this.scheduleRetry(wakeAt);
  }

  private scheduleRetry(retryAt: number): void {
    this.clearRetryTimer();
    this.retryTimer = this.options.timer.setTimeout(
      () => {
        this.retryTimer = null;
        void this.wake();
      },
      Math.max(0, retryAt - this.options.now())
    );
  }

  private clearRetryTimer(): void {
    if (this.retryTimer === null) return;
    this.options.timer.clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  stop(): void {
    this.clearRetryTimer();
    for (const stopRenewal of [...this.stopLeaseRenewals]) stopRenewal();
    if (this.listening) {
      this.options.eventTarget.removeEventListener("online", this.handleOnline);
      this.options.eventTarget.removeEventListener("pageshow", this.handlePageShow);
      this.options.eventTarget.removeEventListener(
        "visibilitychange",
        this.handleVisibilityChange
      );
      this.listening = false;
    }
  }
}
