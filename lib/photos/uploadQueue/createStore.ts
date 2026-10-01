import { IndexedDbPhotoUploadQueueStore } from "./indexedDbStore";
import type { PhotoUploadQueueStore } from "./store";
import { VolatilePhotoUploadQueueStore } from "./volatileStore";

export type PhotoUploadQueueMode = "volatile" | "durable";

export function photoUploadQueueMode(durableEnabled: boolean): PhotoUploadQueueMode {
  return durableEnabled ? "durable" : "volatile";
}

export function photoUploadQueueProviderKey(
  durableEnabled: boolean,
  userId: string,
  locationId: string
): string {
  return `${photoUploadQueueMode(durableEnabled)}:${userId}:${locationId}`;
}

export function createPhotoUploadQueueStore(
  durableEnabled: boolean
): PhotoUploadQueueStore {
  return durableEnabled
    ? new IndexedDbPhotoUploadQueueStore()
    : new VolatilePhotoUploadQueueStore();
}
