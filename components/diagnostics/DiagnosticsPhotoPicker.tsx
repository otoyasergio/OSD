"use client";

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { readPickedPhotoFiles } from "@/lib/forms/readPickedPhotoFiles";
import { photoFileInputProps, CAMERA_ROLL_HINT } from "@/lib/forms/photoSourceInputs";
import { UNREADABLE_PHOTO_MESSAGE } from "@/lib/forms/photoUploadErrors";
import { useOptionalPhotoUploadQueue } from "@/components/photos/PhotoUploadQueueProvider";
import { PhotoQueuePersistenceError } from "@/lib/photos/uploadQueue/errors";
import {
  DIAGNOSTICS_PHOTO_MAX_SELECTED,
  DIAGNOSTICS_PHOTO_PURPOSE_MAX,
  addPhotoSelection,
  collapseWhitespace,
  createObjectUrlRegistry,
  defaultPhotoPurpose,
  isDiagnosticsPhotoEligible,
  type DiagnosticsPhotoSelection,
  type DiagnosticsPhotoSourceRow,
} from "@/lib/diagnostics/photoSelection";
import { PHOTO_CATEGORY_LABELS } from "@/lib/status/labels";
import type { PhotoCategory } from "@/lib/database/types";

type GridPhoto = {
  photoId: string;
  category: PhotoCategory;
  createdAt: string;
  previewUrl: string | null;
};

type LocalPhoto = GridPhoto & { file: File };

function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("en-CA", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function photoLabel(photo: Pick<GridPhoto, "category" | "createdAt">): string {
  const when = formatWhen(photo.createdAt);
  const category = PHOTO_CATEGORY_LABELS[photo.category] ?? "Photo";
  return when ? `${category}, ${when}` : category;
}

export function DiagnosticsPhotoPicker({
  thread,
  photos,
  selections,
  onSelectionsChange,
  requestedPrompt,
  requestKey,
  canMutate,
  preview,
  readOnly,
  disabled = false,
  uploadAllowed = true,
  onBusyChange,
  headingLevel = 4,
}: {
  thread: { threadId: string; workOrderId: string; jobId: string | null };
  photos: DiagnosticsPhotoSourceRow[];
  selections: DiagnosticsPhotoSelection[];
  onSelectionsChange: Dispatch<SetStateAction<DiagnosticsPhotoSelection[]>>;
  requestedPrompt: string | null;
  /** Identifies the assistant message that asked for a photo (focus once per key). */
  requestKey: string | null;
  canMutate: boolean;
  preview: boolean;
  readOnly: boolean;
  disabled?: boolean;
  /** Existing rows may be staged locally even when new assistant uploads are off. */
  uploadAllowed?: boolean;
  onBusyChange?: (busy: boolean) => void;
  /** One level below the conversation heading it sits under. */
  headingLevel?: 4 | 5;
}) {
  const Heading = headingLevel === 5 ? "h5" : "h4";
  const headingId = useId();
  const noteId = useId();
  const queue = useOptionalPhotoUploadQueue();
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const libraryInputRef = useRef<HTMLInputElement>(null);
  const regionRef = useRef<HTMLDivElement>(null);
  const mountedRef = useRef(true);
  const selectionsRef = useRef(selections);
  const interactiveRef = useRef(false);
  const focusedRequests = useRef(new Set<string>());
  const pendingByQueueId = useRef(new Map<string, { file: File; purpose: string }>());
  const handledConfirmations = useRef(new Set<string>());
  const [registry] = useState(() => createObjectUrlRegistry());
  const [localPhotos, setLocalPhotos] = useState<LocalPhoto[]>([]);
  const [uploading, setUploading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cameraProps = photoFileInputProps("camera");
  const libraryProps = photoFileInputProps("library");

  const interactive = canMutate && !preview && !readOnly && !disabled;
  const jobScoped = Boolean(thread.jobId);
  const atLimit = selections.length >= DIAGNOSTICS_PHOTO_MAX_SELECTED;
  const uploadEnabled =
    interactive && uploadAllowed && jobScoped && !atLimit && !uploading && Boolean(queue);
  const selectionEditable = interactive && !uploading;

  useEffect(() => {
    selectionsRef.current = selections;
    interactiveRef.current = interactive;
  }, [selections, interactive]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      registry.revokeAll();
    };
  }, [registry]);

  useEffect(() => {
    if (!requestKey || !requestedPrompt) return;
    if (focusedRequests.current.has(requestKey)) return;
    focusedRequests.current.add(requestKey);
    if (!interactiveRef.current) return;
    const region = regionRef.current;
    region?.focus();
    region?.scrollIntoView?.({ block: "nearest" });
  }, [requestKey, requestedPrompt]);

  const serverThumbs = useMemo(() => {
    const thumbs = new Map<string, string>();
    for (const photo of photos) {
      if (photo.thumb_url) thumbs.set(photo.photo_id, photo.thumb_url);
    }
    return thumbs;
  }, [photos]);

  // Once the server list has its own thumbnail the local blob is redundant.
  useEffect(() => {
    for (const photo of localPhotos) {
      if (serverThumbs.has(photo.photoId)) registry.revoke(photo.photoId);
    }
  }, [serverThumbs, localPhotos, registry]);

  const gridPhotos = useMemo<GridPhoto[]>(() => {
    const scope = { workOrderId: thread.workOrderId, jobId: thread.jobId };
    const localUrls = new Map(
      localPhotos.map((photo) => [photo.photoId, photo.previewUrl])
    );
    const server: GridPhoto[] = photos
      .filter((photo) => isDiagnosticsPhotoEligible(photo, scope))
      .map((photo) => ({
        photoId: photo.photo_id,
        category: photo.category,
        createdAt: photo.created_at,
        previewUrl: photo.thumb_url ?? localUrls.get(photo.photo_id) ?? null,
      }));
    const serverIds = new Set(server.map((photo) => photo.photoId));
    const local: GridPhoto[] = localPhotos
      .filter((photo) => !serverIds.has(photo.photoId))
      .map(({ photoId, category, createdAt, previewUrl }) => ({
        photoId,
        category,
        createdAt,
        previewUrl,
      }));
    return [...local, ...server];
  }, [photos, localPhotos, thread.workOrderId, thread.jobId]);

  const selectedIds = useMemo(
    () => new Set(selections.map((selection) => selection.photoId)),
    [selections]
  );
  const byId = useMemo(
    () => new Map(gridPhotos.map((photo) => [photo.photoId, photo])),
    [gridPhotos]
  );
  const defaultPurpose = defaultPhotoPurpose(requestedPrompt);

  function toggle(photoId: string) {
    setNotice(null);
    const local = localPhotos.find((photo) => photo.photoId === photoId);
    if (selectedIds.has(photoId)) {
      onSelectionsChange((previous) =>
        previous.filter((selection) => selection.photoId !== photoId)
      );
      if (local) {
        registry.revoke(photoId);
        setLocalPhotos((previous) =>
          previous.map((photo) =>
            photo.photoId === photoId ? { ...photo, previewUrl: null } : photo
          )
        );
      }
      return;
    }
    onSelectionsChange(
      (previous) => addPhotoSelection(previous, photoId, defaultPurpose).selections
    );
    if (local && !local.previewUrl && !serverThumbs.has(photoId)) {
      const previewUrl = registry.create(local.file, photoId);
      setLocalPhotos((previous) =>
        previous.map((photo) =>
          photo.photoId === photoId ? { ...photo, previewUrl } : photo
        )
      );
    }
  }

  function setPurpose(photoId: string, purpose: string) {
    onSelectionsChange((previous) =>
      previous.map((selection) =>
        selection.photoId === photoId ? { ...selection, purpose } : selection
      )
    );
  }

  function setBusy(busy: boolean) {
    if (!mountedRef.current) return;
    setUploading(busy);
    onBusyChange?.(busy);
  }

  function applyConfirmation(queueId: string, photoId: string) {
    if (handledConfirmations.current.has(queueId)) return;
    handledConfirmations.current.add(queueId);
    const pending = pendingByQueueId.current.get(queueId);
    pendingByQueueId.current.delete(queueId);
    if (!mountedRef.current) return;
    const file = pending?.file;
    const purpose = pending?.purpose ?? defaultPurpose;
    if (file) {
      const previewUrl = registry.create(file, photoId);
      setLocalPhotos((previous) => [
        ...previous.filter((photo) => photo.photoId !== photoId),
        {
          photoId,
          category: "job_work",
          createdAt: new Date().toISOString(),
          previewUrl,
          file,
        },
      ]);
    }
    const added = addPhotoSelection(selectionsRef.current, photoId, purpose);
    if (added.added) {
      selectionsRef.current = added.selections;
      onSelectionsChange(added.selections);
    } else {
      setNotice(
        added.reason === "limit"
          ? `Photo saved, but not selected: ${DIAGNOSTICS_PHOTO_MAX_SELECTED} photos are already selected. Deselect one, then select the new photo.`
          : "Photo saved, but it was already selected."
      );
    }
    if (pendingByQueueId.current.size === 0) setBusy(false);
  }

  useEffect(() => {
    if (!queue) return undefined;
    return queue.subscribeConfirmation((confirmation) => {
      if (!pendingByQueueId.current.has(confirmation.queueId)) return;
      applyConfirmation(confirmation.queueId, confirmation.photoId);
    });
  }, [queue]);

  useEffect(() => {
    if (!queue) return;
    for (const item of queue.items) {
      if (!pendingByQueueId.current.has(item.queueId) || item.status !== "failed") {
        continue;
      }
      pendingByQueueId.current.delete(item.queueId);
      if (mountedRef.current) {
        setError(item.lastError ?? "Could not upload that photo. Try again.");
        if (pendingByQueueId.current.size === 0) setBusy(false);
      }
    }
  }, [queue]);

  async function uploadFromInput(input: HTMLInputElement) {
    if (!uploadEnabled) {
      input.value = "";
      return;
    }
    setError(null);
    setNotice(null);
    setBusy(true);
    if (!queue) {
      input.value = "";
      setBusy(false);
      return;
    }
    try {
      const prepared = await readPickedPhotoFiles(input);
      for (const [index, file] of prepared.entries()) {
        if (selectionsRef.current.length >= DIAGNOSTICS_PHOTO_MAX_SELECTED) {
          if (mountedRef.current) {
            setNotice(
              `Only ${DIAGNOSTICS_PHOTO_MAX_SELECTED} photos can be sent per message; ${
                prepared.length - index
              } extra photo(s) were not uploaded.`
            );
          }
          break;
        }
        const queuedItem = await queue.enqueue({
          file,
          category: "job_work",
          workOrderId: thread.workOrderId,
          jobId: thread.jobId ?? undefined,
          assistantThreadId: thread.threadId,
          notes: defaultPurpose,
        });
        pendingByQueueId.current.set(queuedItem.queueId, {
          file,
          purpose: defaultPurpose,
        });
        if (!queue.isOnline()) continue;
        const waited = await queue.waitForConfirmations([queuedItem.queueId]);
        if (!waited.ok) {
          const failed = waited.failed[0];
          pendingByQueueId.current.delete(queuedItem.queueId);
          if (mountedRef.current) {
            setError(failed?.lastError ?? "Could not upload that photo. Try again.");
          }
          break;
        }
        const confirmation = waited.confirmations[0];
        if (confirmation) applyConfirmation(confirmation.queueId, confirmation.photoId);
      }
    } catch (caught) {
      if (mountedRef.current) {
        setError(
          caught instanceof PhotoQueuePersistenceError
            ? caught.message
            : UNREADABLE_PHOTO_MESSAGE
        );
      }
    } finally {
      if (pendingByQueueId.current.size === 0) setBusy(false);
    }
  }

  return (
    <div
      ref={regionRef}
      role="group"
      aria-labelledby={headingId}
      tabIndex={-1}
      className="flex flex-col gap-2 rounded border border-[var(--border)] p-3"
    >
      <Heading id={headingId} className="text-sm font-semibold">
        Photos for AI analysis
      </Heading>
      <p className="text-xs text-[var(--status-neutral)]">
        Only the photos you select here are sent for AI analysis (up to{" "}
        {DIAGNOSTICS_PHOTO_MAX_SELECTED}). Image findings describe visible evidence only
        and need technician verification.
      </p>

      {requestedPrompt ? (
        <p className="rounded bg-amber-50 p-2 text-sm text-amber-900">
          Photo requested: {collapseWhitespace(requestedPrompt)}
        </p>
      ) : null}

      {!interactive ? (
        <p className="text-xs text-[var(--status-neutral)]">
          {preview
            ? "Role preview is read-only — photo selection is off."
            : readOnly
              ? "This work order is read-only — photo selection is off."
              : "Photo selection is unavailable right now."}
        </p>
      ) : null}

      {gridPhotos.length > 0 ? (
        <ul className="flex flex-wrap gap-2" aria-label="Available photos">
          {gridPhotos.map((photo) => {
            const selected = selectedIds.has(photo.photoId);
            const label = photoLabel(photo);
            return (
              <li key={photo.photoId}>
                <button
                  type="button"
                  aria-pressed={selected}
                  aria-label={`${selected ? "Deselect" : "Select"} ${label}`}
                  disabled={!selectionEditable || (!selected && atLimit)}
                  onClick={() => toggle(photo.photoId)}
                  className={`flex h-20 w-20 items-center justify-center overflow-hidden rounded border-2 bg-[var(--surface-muted)] text-xs ${
                    selected ? "border-[var(--brand,#0a58ca)]" : "border-transparent"
                  } disabled:opacity-50`}
                >
                  {photo.previewUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element -- signed or local blob preview
                    <img
                      src={photo.previewUrl}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <span>{PHOTO_CATEGORY_LABELS[photo.category] ?? "Photo"}</span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-xs text-[var(--status-neutral)]">
          No inspection or job photos are available to select yet.
        </p>
      )}

      <p className="text-xs" aria-live="polite">
        Selected {selections.length} of {DIAGNOSTICS_PHOTO_MAX_SELECTED}
      </p>

      {selections.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {selections.map((selection, index) => {
            const grid = byId.get(selection.photoId);
            const label = grid ? photoLabel(grid) : "Selected photo";
            const inputId = `${headingId}-purpose-${selection.photoId}`;
            return (
              <li key={selection.photoId} className="flex flex-col gap-1">
                <label htmlFor={inputId} className="text-xs font-medium">
                  Purpose for photo {index + 1} ({label})
                </label>
                <div className="flex gap-2">
                  <input
                    id={inputId}
                    type="text"
                    className="input flex-1"
                    value={selection.purpose}
                    maxLength={DIAGNOSTICS_PHOTO_PURPOSE_MAX}
                    disabled={!selectionEditable}
                    onChange={(event) =>
                      setPurpose(selection.photoId, event.target.value)
                    }
                    onKeyDown={(event) => {
                      if (event.key === "Enter") event.preventDefault();
                    }}
                  />
                  <button
                    type="button"
                    className="btn btn-secondary"
                    aria-label={`Remove photo ${index + 1} (${label})`}
                    disabled={!selectionEditable}
                    onClick={() => toggle(selection.photoId)}
                  >
                    Remove
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}

      {interactive && !jobScoped ? (
        <p className="text-xs text-[var(--status-neutral)]">
          New photos attach to a job. Open Ask OTOMOTO from a job to add a photo; existing
          inspection photos can still be selected.
        </p>
      ) : null}

      {jobScoped ? (
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={cameraInputRef}
            type="file"
            accept={cameraProps.accept}
            capture={cameraProps.capture}
            className="photo-file-input"
            tabIndex={-1}
            aria-hidden="true"
            disabled={!uploadEnabled}
            onChange={(event) => void uploadFromInput(event.currentTarget)}
          />
          <input
            ref={libraryInputRef}
            type="file"
            accept={libraryProps.accept}
            multiple
            className="photo-file-input"
            tabIndex={-1}
            aria-hidden="true"
            disabled={!uploadEnabled}
            onChange={(event) => void uploadFromInput(event.currentTarget)}
          />
          <button
            type="button"
            className="btn btn-secondary disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!uploadEnabled}
            aria-disabled={!uploadEnabled}
            aria-describedby={noteId}
            onClick={() => cameraInputRef.current?.click()}
          >
            Camera
          </button>
          <button
            type="button"
            className="btn btn-secondary disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!uploadEnabled}
            aria-disabled={!uploadEnabled}
            aria-describedby={noteId}
            onClick={() => libraryInputRef.current?.click()}
          >
            Library
          </button>
          <span id={noteId} className="text-xs text-[var(--status-neutral)]">
            {CAMERA_ROLL_HINT}
          </span>
        </div>
      ) : null}

      {uploading ? (
        <p role="status" className="text-sm">
          Uploading photo…
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="text-sm text-amber-900">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}
