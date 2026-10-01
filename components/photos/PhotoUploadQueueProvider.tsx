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
import { IndexedDbPhotoUploadQueueStore } from "@/lib/photos/uploadQueue/indexedDbStore";
import type { PhotoUploadQueueStore } from "@/lib/photos/uploadQueue/store";
import type { PhotoUploadScope, QueuedPhotoUpload } from "@/lib/photos/uploadQueue/types";
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
  | { ok: false; failed: QueuedPhotoUpload[] };

export type PhotoUploadQueueApi = {
  items: QueuedPhotoUpload[];
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
  children: ReactNode;
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
  const lastNowRef = useRef(0);
  const nowFnRef = useRef(now);
  const isOnlineFnRef = useRef(isOnline);
  const [items, setItems] = useState<QueuedPhotoUpload[]>([]);
  const [previewUrls, setPreviewUrls] = useState<Record<string, string>>({});
  const confirmationsRef = useRef(new Map<string, PhotoUploadConfirmation>());
  const confirmationListenersRef = useRef(
    new Set<(confirmation: PhotoUploadConfirmation) => void>()
  );
  const waitersRef = useRef(new Set<() => void>());
  const runnerRef = useRef<PhotoUploadQueueRunner | null>(null);
  const previewUrlsRef = useRef<Record<string, string>>({});
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

  const refreshItems = useCallback(async () => {
    const next = await store.list(scope);
    setItems(next);
    setPreviewUrls((current) => {
      const synced = syncPreviewUrls(current, next);
      previewUrlsRef.current = synced;
      return synced;
    });
    for (const waiter of waitersRef.current) waiter();
  }, [store, scope]);

  const recordConfirmation = useCallback((confirmation: PhotoUploadConfirmation) => {
    confirmationsRef.current.set(confirmation.queueId, confirmation);
    for (const listener of confirmationListenersRef.current) listener(confirmation);
    for (const waiter of waitersRef.current) waiter();
  }, []);

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
    confirmationsRef.current = new Map();
    const ownerId =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `runner-${scope.userId}-${scope.locationId}`;
    const runner = new PhotoUploadQueueRunner({
      scope,
      store,
      uploader: async (item, signal) => {
        const outcome = await uploadQueuedPhoto(item, signal, {
          uploadIntakePhoto,
          uploadAssistantPhoto,
        });
        if (outcome.ok) {
          recordConfirmation({
            queueId: item.queueId,
            clientUploadId: item.clientUploadId,
            photoId: outcome.photoId,
          });
        }
        return outcome;
      },
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
      void runner.stop();
      if (runnerRef.current === runner) runnerRef.current = null;
    };
  }, [
    isOnlineFn,
    readNow,
    recordConfirmation,
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
      const inspect = async (): Promise<PhotoUploadQueueWaitResult | null> => {
        const listed = await store.list(scope);
        const confirmations = queueIds.flatMap((queueId) => {
          const confirmation = confirmationsRef.current.get(queueId);
          return confirmation ? [confirmation] : [];
        });
        if (confirmations.length === queueIds.length) {
          return { ok: true, confirmations };
        }
        const failed = listed.filter(
          (item) => queueIds.includes(item.queueId) && item.status === "failed"
        );
        if (failed.length > 0) return { ok: false, failed };
        return null;
      };

      const immediate = await inspect();
      if (immediate) return immediate;

      return new Promise((resolve) => {
        const waiter = () => {
          void inspect().then((result) => {
            if (!result) return;
            waitersRef.current.delete(waiter);
            resolve(result);
          });
        };
        waitersRef.current.add(waiter);
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
