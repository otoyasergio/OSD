import type {
  PhotoUploadQueueDatabase,
  PhotoUploadQueueTransaction,
} from "@/lib/photos/uploadQueue/indexedDbStore";
import type {
  PhotoUploadConfirmationReceipt,
  PhotoUploadScope,
  QueuedPhotoUpload,
} from "@/lib/photos/uploadQueue/types";

type CommitGate = {
  started: Promise<void>;
  release(): void;
};

type MutableCommitGate = CommitGate & {
  markStarted(): void;
  released: Promise<void>;
};

function createCommitGate(): MutableCommitGate {
  let markStarted: () => void = () => {};
  let release: () => void = () => {};
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  return {
    started,
    released,
    markStarted: () => markStarted(),
    release: () => release(),
  };
}

export type TransactionalPhotoUploadQueueDatabase = {
  openDatabase(): Promise<PhotoUploadQueueDatabase>;
  pauseNextCommit(): CommitGate;
  committedItems(): QueuedPhotoUpload[];
};

export function createTransactionalPhotoUploadQueueDatabase(): TransactionalPhotoUploadQueueDatabase {
  let committedItems = new Map<string, QueuedPhotoUpload>();
  let committedConfirmations = new Map<string, PhotoUploadConfirmationReceipt>();
  let transactionTail = Promise.resolve();
  let nextCommitGate: MutableCommitGate | null = null;

  const database: PhotoUploadQueueDatabase = {
    transaction(): PhotoUploadQueueTransaction {
      const waitForPriorTransaction = transactionTail;
      let releaseTransaction: () => void = () => {};
      transactionTail = new Promise<void>((resolve) => {
        releaseTransaction = resolve;
      });
      let stagedItems: Map<string, QueuedPhotoUpload> | null = null;
      let stagedConfirmations: Map<string, PhotoUploadConfirmationReceipt> | null = null;
      let operationTail = Promise.resolve();
      let donePromise: Promise<void> | null = null;

      const withStaged = <T>(
        operation: (
          items: Map<string, QueuedPhotoUpload>,
          confirmations: Map<string, PhotoUploadConfirmationReceipt>
        ) => T | Promise<T>
      ): Promise<T> => {
        const result = operationTail.then(async () => {
          await waitForPriorTransaction;
          stagedItems ??= new Map(
            [...committedItems].map(([key, item]) => [key, structuredClone(item)])
          );
          stagedConfirmations ??= new Map(
            [...committedConfirmations].map(([key, receipt]) => [
              key,
              structuredClone(receipt),
            ])
          );
          return operation(stagedItems, stagedConfirmations);
        });
        operationTail = result.then(
          () => undefined,
          () => undefined
        );
        return result;
      };

      const transaction: PhotoUploadQueueTransaction = {
        get: (queueId) => withStaged((items) => items.get(queueId)),
        listByScope: (scope: PhotoUploadScope) =>
          withStaged((items) =>
            [...items.values()].filter(
              (item) =>
                item.userId === scope.userId && item.locationId === scope.locationId
            )
          ),
        put: (item) =>
          withStaged((items) => {
            items.set(item.queueId, structuredClone(item));
          }),
        delete: (queueId) =>
          withStaged((items) => {
            items.delete(queueId);
          }),
        getConfirmation: (queueId) =>
          withStaged((_items, confirmations) => confirmations.get(queueId)),
        listConfirmationsByScope: (scope: PhotoUploadScope) =>
          withStaged((_items, confirmations) =>
            [...confirmations.values()].filter(
              (receipt) =>
                receipt.userId === scope.userId && receipt.locationId === scope.locationId
            )
          ),
        putConfirmation: (receipt) =>
          withStaged((_items, confirmations) => {
            confirmations.set(receipt.queueId, structuredClone(receipt));
          }),
        deleteConfirmation: (queueId) =>
          withStaged((_items, confirmations) => {
            confirmations.delete(queueId);
          }),
        get done() {
          donePromise ??= (async () => {
            try {
              await waitForPriorTransaction;
              let observedOperations: Promise<void>;
              do {
                observedOperations = operationTail;
                await observedOperations;
                await Promise.resolve();
              } while (observedOperations !== operationTail);
              const gate = nextCommitGate;
              nextCommitGate = null;
              if (gate) {
                gate.markStarted();
                await gate.released;
              }
              if (stagedItems) committedItems = stagedItems;
              if (stagedConfirmations) committedConfirmations = stagedConfirmations;
            } finally {
              releaseTransaction();
            }
          })();
          return donePromise;
        },
      };
      return transaction;
    },
  };

  return {
    openDatabase: async () => database,
    pauseNextCommit(): CommitGate {
      const gate = createCommitGate();
      nextCommitGate = gate;
      return gate;
    },
    committedItems: () =>
      [...committedItems.values()].map((item) => structuredClone(item)),
  };
}
