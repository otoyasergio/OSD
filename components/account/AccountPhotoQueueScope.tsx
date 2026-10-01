"use client";

import type { ReactNode } from "react";
import { PhotoUploadQueueProvider } from "@/components/photos/PhotoUploadQueueProvider";
import type { PhotoUploadQueueStore } from "@/lib/photos/uploadQueue/store";

export function AccountPhotoQueueScope({
  userId,
  locationId,
  children,
  store,
  isOnline,
}: {
  userId: string;
  locationId: string | null;
  children?: ReactNode;
  store?: PhotoUploadQueueStore;
  isOnline?: () => boolean;
}) {
  if (!locationId) return children;
  return (
    <PhotoUploadQueueProvider
      userId={userId}
      locationId={locationId}
      store={store}
      isOnline={isOnline}
    >
      {children}
    </PhotoUploadQueueProvider>
  );
}
