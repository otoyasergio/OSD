"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { uploadAssistantPhotoAction } from "@/app/(app)/work_orders/assistant-actions";
import { uploadIntakePhotoAction } from "@/app/(app)/work_orders/photo-actions";
import { enqueuePhotoUpload } from "@/lib/photos/uploadQueue/enqueue";
import { withPhotoUploadQueueNotifications } from "@/lib/photos/uploadQueue/notifyingStore";
import {
  newestIncompleteIntakeDraft,
  photoUploadQueueCounts,
  prepareQueuedPhoto,
} from "@/lib/photos/uploadQueue/prepareQueuedPhoto";
import { PhotoUploadQueueRunner } from "@/lib/photos/uploadQueue/runner";
import { PhotoUploadQueueClosedError } from "@/lib/photos/uploadQueue/errors";
import { IndexedDbPhotoUploadQueueStore } from "@/lib/photos/uploadQueue/indexedDbStore";
import type { PhotoUploadQueueStore } from "@/lib/photos/uploadQueue/store";
import {
  PHOTO_CONFIRMATION_TTL_MS,
  type PhotoUploadConfirmationReceipt,
  type PhotoUploadScope,
  type QueuedPhotoUpload,
} from "@/lib/photos/uploadQueue/types";
import {
  uploadQueuedPhoto,
  type QueuedPhotoUploadActions,
} from "@/lib/photos/uploadQueue/uploadQueuedPhoto";

export type PhotoUploadConfirmation = {
  queueId: string;
  clientUploadId: string;
  photoId: string;
};

export type EnqueuePhotoInput = {
  file: File;
  category: string;
  workOrderId?: string;
  intakeDraftId?: string;
  jobId?: string;
  inspectionResultId?: string;
  assistantThreadId?: string;
  notes?: string;
  replaceExisting?: boolean;
};

export type PhotoUploadQueueWaitResult =
  | { ok: true; confirmations: PhotoUploadConfirmation[] }
  | { ok: false; failed: QueuedPhotoUpload[]; missingQueueIds: string[] };

export type PhotoUploadQueueApi = {
  items: QueuedPhotoUpload[];
  confirmations: PhotoUploadConfirmationReceipt[];
  counts: { waiting: number; uploading: number; failed: number };
  enqueue(input: EnqueuePhotoInput): Promise<QueuedPhotoUpload>;
  remove(queueId: string): Promise<boolean>;
  retry(queueId: string): Promise<QueuedPhotoUpload | null>;
  findNewestIncompleteIntakeDraft(): Promise<{
    intakeDraftId: string;
    items: QueuedPhotoUpload[];
  } | null>;
  attachDraftToWorkOrder(
    intakeDraftId: string,
    workOrderId: string
  ): Promise<QueuedPhotoUpload[]>;
  waitForConfirmations(queueIds: string[]): Promise<PhotoUploadQueueWaitResult>;
  subscribeConfirmation(
    listener: (confirmation: PhotoUploadConfirmation) => void
  ): () => void;
  previewUrl(queueId: string): string | null;
  isOnline(): boolean;
};

const PhotoUploadQueueContext = createContext<PhotoUploadQueueApi | null>(null);

export function usePhotoUploadQueue(): PhotoUploadQueueApi {
  const api = useContext(PhotoUploadQueueContext);
  if (!api) {
    throw new Error("usePhotoUploadQueue must be used within PhotoUploadQueueProvider.");
  }
  return api;
}

export function useOptionalPhotoUploadQueue(): PhotoUploadQueueApi | null {
  return useContext(PhotoUploadQueueContext);
}

type ProviderProps = {
  userId: string;
  locationId: string;
  children?: ReactNode;
  store?: PhotoUploadQueueStore;
  uploadIntakePhoto?: QueuedPhotoUploadActions["uploadIntakePhoto"];
  uploadAssistantPhoto?: QueuedPhotoUploadActions["uploadAssistantPhoto"];
  isOnline?: () => boolean;
  now?: () => number;
};

export function PhotoUploadQueueProvider({
  userId,
  locationId,
  children,
  store: storeOverride,
  uploadIntakePhoto = uploadIntakePhotoAction,
  uploadAssistantPhoto = uploadAssistantPhotoAction,
  isOnline,
  now,
}: ProviderProps) {
  const scope = useMemo<PhotoUploadScope>(
    () => ({ userId, locationId }),
    [userId, locationId]
  );
  const scopeKey = `${userId}:${locationId}`;
  const lastNowRef = useRef(0);
  const nowFnRef = useRef(now);
  const isOnlineFnRef = useRef(isOnline);
  const [items, setItems] = useState<QueuedPhotoUpload[]>([]);
  const [confirmations, setConfirmations] = useState<PhotoUploadConfirmationReceipt[]>(
    []
  );
  const [previewUrls, setPreviewUrls] = useState<Record<string, string>>({});
  const [activeScopeKey, setActiveScopeKey] = useState(scopeKey);
  const confirmationListenersRef = useRef(
    new Set<(confirmation: PhotoUploadConfirmation) => void>()
  );
  const seenReceiptIdsRef = useRef(new Set<string>());
  const waitersRef = useRef(new Set<ConfirmationWaiter>());
  const runnerRef = useRef<PhotoUploadQueueRunner | null>(null);
  const previewUrlsRef = useRef<Record<string, string>>({});
  const closedRef = useRef(false);
  const scopeEpochRef = useRef(0);
  const pruneScheduledRef = useRef(false);
  if (activeScopeKey !== scopeKey) {
    setActiveScopeKey(scopeKey);
    setItems([]);
    setConfirmations([]);
    setPreviewUrls((current) => {
      for (const url of Object.values(current)) URL.revokeObjectURL(url);
      return {};
    });
  }
  const storeEvents = useMemo(() => new EventTarget(), []);

  const readNow = useCallback(() => {
    const value = (nowFnRef.current ?? (() => Date.now()))();
    lastNowRef.current = value > lastNowRef.current ? value : lastNowRef.current + 1;
    return lastNowRef.current;
  }, []);
  const isOnlineFn = useCallback(
    () => (isOnlineFnRef.current ?? (() => navigator.onLine))(),
    []
  );

  const innerStore = useMemo(
    () => storeOverride ?? new IndexedDbPhotoUploadQueueStore(),
    [storeOverride]
  );
  const store = useMemo(
    () =>
      withPhotoUploadQueueNotifications(innerStore, () => {
        storeEvents.dispatchEvent(new Event("change"));
      }),
    [innerStore, storeEvents]
  );

  const rejectWaiters = useCallback((error: Error) => {
    const waiters = [...waitersRef.current];
    waitersRef.current.clear();
    for (const waiter of waiters) waiter.reject(error);
  }, []);

  const emitNewReceipts = useCallback((receipts: PhotoUploadConfirmationReceipt[]) => {
    for (const receipt of receipts) {
      if (seenReceiptIdsRef.current.has(receipt.queueId)) continue;
      seenReceiptIdsRef.current.add(receipt.queueId);
      const confirmation: PhotoUploadConfirmation = {
        queueId: receipt.queueId,
        clientUploadId: receipt.clientUploadId,
        photoId: receipt.photoId,
      };
      for (const listener of confirmationListenersRef.current) listener(confirmation);
    }
  }, []);

  const refreshItems = useCallback(async () => {
    if (closedRef.current) return;
    const epoch = scopeEpochRef.current;
    const scoped = scope;
    let next: QueuedPhotoUpload[];
    let receipts: PhotoUploadConfirmationReceipt[];
    try {
      [next, receipts] = await Promise.all([
        store.list(scoped),
        store.listConfirmations(scoped),
      ]);
    } catch (error) {
      if (closedRef.current || scopeEpochRef.current !== epoch) return;
      console.error("Photo upload queue refresh failed", error);
      return;
    }
    if (closedRef.current || scopeEpochRef.current !== epoch) return;
    setItems(next);
    setConfirmations(receipts);
    setPreviewUrls((current) => {
      const synced = syncPreviewUrls(current, next);
      previewUrlsRef.current = synced;
      return synced;
    });
    emitNewReceipts(receipts);
    for (const waiter of waitersRef.current) waiter.refresh();
    if (pruneScheduledRef.current) return;
    pruneScheduledRef.current = true;
    const keep = new Set<string>([
      ...next.map((item) => item.queueId),
      ...[...waitersRef.current].flatMap((waiter) => waiter.queueIds),
    ]);
    void store
      .pruneConfirmations(scoped, readNow() - PHOTO_CONFIRMATION_TTL_MS, keep)
      .catch(() => {
        if (scopeEpochRef.current === epoch) pruneScheduledRef.current = false;
      });
  }, [emitNewReceipts, readNow, store, scope]);

  useEffect(() => {
    nowFnRef.current = now;
    isOnlineFnRef.current = isOnline;
  }, [isOnline, now]);

  useEffect(() => {
    const onStoreChange = () => {
      void refreshItems();
    };
    storeEvents.addEventListener("change", onStoreChange);
    return () => storeEvents.removeEventListener("change", onStoreChange);
  }, [refreshItems, storeEvents]);

  useEffect(() => {
    const epoch = ++scopeEpochRef.current;
    closedRef.current = false;
    pruneScheduledRef.current = false;
    seenReceiptIdsRef.current = new Set();
    previewUrlsRef.current = {};
    const ownerId =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `runner-${scope.userId}-${scope.locationId}`;
    const runner = new PhotoUploadQueueRunner({
      scope,
      store,
      uploader: async (item, signal) =>
        uploadQueuedPhoto(item, signal, {
          uploadIntakePhoto,
          uploadAssistantPhoto,
        }),
      now: readNow,
      timer: {
        setTimeout: (callback, delayMs) => window.setTimeout(callback, delayMs),
        clearTimeout: (handle) => window.clearTimeout(handle as number),
      },
      isOnline: isOnlineFn,
      isVisible: () => document.visibilityState !== "hidden",
      eventTarget: window,
      ownerId,
    });
    runnerRef.current = runner;
    void runner.start().then(() => {
      storeEvents.dispatchEvent(new Event("change"));
    });
    return () => {
      closedRef.current = true;
      if (scopeEpochRef.current === epoch) scopeEpochRef.current += 1;
      rejectWaiters(new PhotoUploadQueueClosedError());
      void runner.stop();
      if (runnerRef.current === runner) runnerRef.current = null;
    };
  }, [
    isOnlineFn,
    readNow,
    rejectWaiters,
    scope,
    store,
    storeEvents,
    uploadAssistantPhoto,
    uploadIntakePhoto,
  ]);

  useEffect(() => {
    return () => {
      for (const url of Object.values(previewUrlsRef.current)) {
        URL.revokeObjectURL(url);
      }
      if (!storeOverride && innerStore instanceof IndexedDbPhotoUploadQueueStore) {
        void innerStore.close();
      }
    };
  }, [innerStore, storeOverride]);

  const enqueue = useCallback(
    async (input: EnqueuePhotoInput) => {
      const prepared = await prepareQueuedPhoto({
        ...input,
        userId: scope.userId,
        locationId: scope.locationId,
        now: readNow(),
      });
      const replaceExisting =
        input.replaceExisting ??
        Boolean(
          prepared.intakeDraftId && !prepared.workOrderId && prepared.category !== "other"
        );
      const queued =
        replaceExisting && prepared.intakeDraftId
          ? await store.replaceDraftCategory(
              scope,
              prepared.intakeDraftId,
              prepared.category,
              { ...prepared, status: "queued" },
              readNow()
            )
          : await enqueuePhotoUpload({
              store,
              scope,
              item: prepared,
              now: readNow(),
            });
      await refreshItems();
      if (queued.workOrderId) await runnerRef.current?.wake();
      return queued;
    },
    [readNow, refreshItems, scope, store]
  );

  const remove = useCallback(
    async (queueId: string) => {
      const removed = await store.removeUnclaimed(queueId, scope, readNow());
      await refreshItems();
      return removed;
    },
    [readNow, refreshItems, scope, store]
  );

  const retry = useCallback(
    async (queueId: string) => {
      const retried = await store.retryFailed(queueId, scope, readNow());
      await refreshItems();
      if (retried?.workOrderId) await runnerRef.current?.wake();
      return retried;
    },
    [readNow, refreshItems, scope, store]
  );

  const findNewestIncompleteIntakeDraft = useCallback(async () => {
    const listed = await store.list(scope);
    return newestIncompleteIntakeDraft(listed);
  }, [scope, store]);

  const attachDraftToWorkOrder = useCallback(
    async (intakeDraftId: string, workOrderId: string) => {
      const attached = await store.attachDraftToWorkOrder(
        scope,
        intakeDraftId,
        workOrderId,
        readNow()
      );
      await refreshItems();
      await runnerRef.current?.wake();
      return attached;
    },
    [readNow, refreshItems, scope, store]
  );

  const waitForConfirmations = useCallback(
    async (queueIds: string[]): Promise<PhotoUploadQueueWaitResult> => {
      const expected = [...new Set(queueIds)];
      if (expected.length === 0) {
        return { ok: false, failed: [], missingQueueIds: [] };
      }

      const inspect = async (): Promise<PhotoUploadQueueWaitResult | "wait"> => {
        const epoch = scopeEpochRef.current;
        if (closedRef.current) throw new PhotoUploadQueueClosedError();
        const [listed, receipts] = await Promise.all([
          store.list(scope),
          store.listConfirmations(scope),
        ]);
        if (closedRef.current || scopeEpochRef.current !== epoch) {
          throw new PhotoUploadQueueClosedError();
        }
        const receiptById = new Map(
          receipts.map((receipt) => [receipt.queueId, receipt] as const)
        );
        const itemById = new Map(listed.map((item) => [item.queueId, item] as const));
        const confirmed: PhotoUploadConfirmation[] = [];
        const failed: QueuedPhotoUpload[] = [];
        const missingQueueIds: string[] = [];

        for (const queueId of expected) {
          const receipt = receiptById.get(queueId);
          if (receipt) {
            confirmed.push({
              queueId: receipt.queueId,
              clientUploadId: receipt.clientUploadId,
              photoId: receipt.photoId,
            });
            continue;
          }
          const item = itemById.get(queueId);
          if (!item) {
            missingQueueIds.push(queueId);
            continue;
          }
          if (item.status === "failed") failed.push(item);
        }

        if (missingQueueIds.length > 0 || failed.length > 0) {
          return { ok: false, failed, missingQueueIds };
        }
        if (confirmed.length === expected.length) {
          return { ok: true, confirmations: confirmed };
        }
        return "wait";
      };

      const immediate = await inspect();
      if (closedRef.current) throw new PhotoUploadQueueClosedError();
      if (immediate !== "wait") return immediate;

      return new Promise((resolve, reject) => {
        if (closedRef.current) {
          reject(new PhotoUploadQueueClosedError());
          return;
        }
        let settled = false;
        const waiter: ConfirmationWaiter = {
          queueIds: expected,
          refresh: () => {
            void inspect().then(
              (result) => {
                if (result === "wait" || settled) return;
                settled = true;
                waitersRef.current.delete(waiter);
                resolve(result);
              },
              (error: unknown) => {
                if (settled) return;
                settled = true;
                waitersRef.current.delete(waiter);
                reject(error);
              }
            );
          },
          reject: (error) => {
            if (settled) return;
            settled = true;
            waitersRef.current.delete(waiter);
            reject(error);
          },
        };
        waitersRef.current.add(waiter);
        waiter.refresh();
      });
    },
    [scope, store]
  );

  const subscribeConfirmation = useCallback(
    (listener: (confirmation: PhotoUploadConfirmation) => void) => {
      confirmationListenersRef.current.add(listener);
      return () => {
        confirmationListenersRef.current.delete(listener);
      };
    },
    []
  );

  const previewUrl = useCallback(
    (queueId: string) => previewUrls[queueId] ?? null,
    [previewUrls]
  );

  const api = useMemo<PhotoUploadQueueApi>(
    () => ({
      items,
      confirmations,
      counts: photoUploadQueueCounts(items),
      enqueue,
      remove,
      retry,
      findNewestIncompleteIntakeDraft,
      attachDraftToWorkOrder,
      waitForConfirmations,
      subscribeConfirmation,
      previewUrl,
      isOnline: isOnlineFn,
    }),
    [
      attachDraftToWorkOrder,
      confirmations,
      enqueue,
      findNewestIncompleteIntakeDraft,
      isOnlineFn,
      items,
      previewUrl,
      remove,
      retry,
      subscribeConfirmation,
      waitForConfirmations,
    ]
  );

  return (
    <PhotoUploadQueueContext.Provider value={api}>
      {children}
    </PhotoUploadQueueContext.Provider>
  );
}

type ConfirmationWaiter = {
  queueIds: string[];
  refresh(): void;
  reject(error: Error): void;
};

function syncPreviewUrls(
  current: Record<string, string>,
  items: QueuedPhotoUpload[]
): Record<string, string> {
  const next: Record<string, string> = {};
  const seen = new Set(items.map((item) => item.queueId));
  for (const item of items) {
    next[item.queueId] = current[item.queueId] ?? URL.createObjectURL(item.blob);
  }
  for (const [queueId, url] of Object.entries(current)) {
    if (!seen.has(queueId)) URL.revokeObjectURL(url);
  }
  return next;
}
