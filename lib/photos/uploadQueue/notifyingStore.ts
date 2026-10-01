import type { PhotoUploadQueueStore } from "./store";

const MUTATING_METHODS = new Set<keyof PhotoUploadQueueStore>([
  "put",
  "update",
  "remove",
  "recoverInterrupted",
  "tryAcquireLease",
  "tryAcquireUploadClaim",
  "renewUploadClaim",
  "releaseUnstartedUploadClaim",
  "updateClaimed",
  "settleClaimedFailure",
  "completeClaimedUpload",
  "releaseUploadClaim",
  "attachDraftToWorkOrder",
  "retryFailed",
  "removeUnclaimed",
  "replaceDraftCategory",
]);

export function withPhotoUploadQueueNotifications(
  store: PhotoUploadQueueStore,
  onChange: () => void
): PhotoUploadQueueStore {
  return new Proxy(store, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver) as unknown;
      if (
        typeof property !== "string" ||
        typeof value !== "function" ||
        !MUTATING_METHODS.has(property as keyof PhotoUploadQueueStore)
      ) {
        return value;
      }
      return async (...args: unknown[]) => {
        const result = await (value as (...inner: unknown[]) => Promise<unknown>).apply(
          target,
          args
        );
        onChange();
        return result;
      };
    },
  });
}
