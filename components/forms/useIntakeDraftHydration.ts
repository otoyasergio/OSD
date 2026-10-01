"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { IntakePhotoSelection } from "@/components/forms/IntakePhotoSlots";
import { usePhotoUploadQueue } from "@/components/photos/PhotoUploadQueueProvider";
import {
  extraFilesFromQueuedIntakeItems,
  filesFromQueuedIntakeItems,
} from "@/lib/photos/intakeQueue";
import type { QueuedPhotoUpload } from "@/lib/photos/uploadQueue/types";

export function useIntakeDraftHydration(): {
  intakeDraftId: string;
  hydrating: boolean;
  restoredItems: QueuedPhotoUpload[] | null;
  restoredPhotos: IntakePhotoSelection;
  restoredExtras: File[];
  photosRestored: boolean;
  markPicksBegun: () => void;
} {
  const queue = usePhotoUploadQueue();
  const picksBegunRef = useRef(false);
  const [intakeDraftId, setIntakeDraftId] = useState(() => crypto.randomUUID());
  const [hydrating, setHydrating] = useState(true);
  const [restoredItems, setRestoredItems] = useState<QueuedPhotoUpload[] | null>(null);
  const [restoredPhotos, setRestoredPhotos] = useState<IntakePhotoSelection>({});
  const [restoredExtras, setRestoredExtras] = useState<File[]>([]);
  const [photosRestored, setPhotosRestored] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void queue
      .findNewestIncompleteIntakeDraft()
      .then((draft) => {
        if (cancelled) return;
        if (draft && !picksBegunRef.current) {
          setIntakeDraftId(draft.intakeDraftId);
          setRestoredItems(draft.items);
          setRestoredPhotos(filesFromQueuedIntakeItems(draft.items));
          setRestoredExtras(extraFilesFromQueuedIntakeItems(draft.items));
          setPhotosRestored(true);
        }
        setHydrating(false);
      })
      .catch(() => {
        if (!cancelled) setHydrating(false);
      });
    return () => {
      cancelled = true;
    };
  }, [queue]);

  const markPicksBegun = useCallback(() => {
    picksBegunRef.current = true;
  }, []);

  return {
    intakeDraftId,
    hydrating,
    restoredItems,
    restoredPhotos,
    restoredExtras,
    photosRestored,
    markPicksBegun,
  };
}
