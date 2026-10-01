import type {
  PhotoUploadQueueDatabase,
  PhotoUploadQueueTransaction,
} from "@/lib/photos/uploadQueue/indexedDbStore";
import type { PhotoUploadScope, QueuedPhotoUpload } from "@/lib/photos/uploadQueue/types";

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
  let committed = new Map<string, QueuedPhotoUpload>();
  let transactionTail = Promise.resolve();
  let nextCommitGate: MutableCommitGate | null = null;

  const database: PhotoUploadQueueDatabase = {
    transaction(): PhotoUploadQueueTransaction {
      const waitForPriorTransaction = transactionTail;
      let releaseTransaction: () => void = () => {};
      transactionTail = new Promise<void>((resolve) => {
        releaseTransaction = resolve;
      });
      let staged: Map<string, QueuedPhotoUpload> | null = null;
      let operationTail = Promise.resolve();
      let donePromise: Promise<void> | null = null;

      const withStaged = <T>(
        operation: (items: Map<string, QueuedPhotoUpload>) => T | Promise<T>
      ): Promise<T> => {
        const result = operationTail.then(async () => {
          await waitForPriorTransaction;
          staged ??= new Map(
            [...committed].map(([key, item]) => [key, structuredClone(item)])
          );
          return operation(staged);
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
        get done() {
          donePromise ??= (async () => {
            try {
              await waitForPriorTransaction;
              await operationTail;
              const gate = nextCommitGate;
              nextCommitGate = null;
              if (gate) {
                gate.markStarted();
                await gate.released;
              }
              if (staged) committed = staged;
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
    committedItems: () => [...committed.values()].map((item) => structuredClone(item)),
  };
}
