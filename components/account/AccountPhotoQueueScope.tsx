"use client";

import type { ReactNode } from "react";
import { PhotoUploadQueueProvider } from "@/components/photos/PhotoUploadQueueProvider";
import { photoUploadQueueProviderKey } from "@/lib/photos/uploadQueue/createStore";
import type { PhotoUploadQueueStore } from "@/lib/photos/uploadQueue/store";

export function AccountPhotoQueueScope({
  userId,
  locationId,
  children,
  store,
  isOnline,
  durableQueueEnabled = false,
}: {
  userId: string;
  locationId: string | null;
  children?: ReactNode;
  store?: PhotoUploadQueueStore;
  isOnline?: () => boolean;
  durableQueueEnabled?: boolean;
}) {
  if (!locationId) return children;
  return (
    <PhotoUploadQueueProvider
      key={photoUploadQueueProviderKey(durableQueueEnabled, userId, locationId)}
      userId={userId}
      locationId={locationId}
      store={store}
      isOnline={isOnline}
      durableQueueEnabled={durableQueueEnabled}
    >
      {children}
    </PhotoUploadQueueProvider>
  );
}
