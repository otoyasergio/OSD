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
import {
  uploadAssistantPhotoAction,
  type AssistantActionState,
} from "@/app/(app)/work_orders/assistant-actions";
import { readPickedPhotoFiles } from "@/lib/forms/readPickedPhotoFiles";
import { photoFileInputProps, CAMERA_ROLL_HINT } from "@/lib/forms/photoSourceInputs";
import { UNREADABLE_PHOTO_MESSAGE } from "@/lib/forms/photoUploadErrors";
import { withPhotoUploadRetries } from "@/lib/forms/retryPhotoUpload";
import {
  DIAGNOSTICS_PHOTO_MAX_SELECTED,
  DIAGNOSTICS_PHOTO_PURPOSE_MAX,
  addPhotoSelection,
  createObjectUrlRegistry,
  defaultPhotoPurpose,
  isDiagnosticsPhotoEligible,
  type DiagnosticsPhotoSelection,
  type DiagnosticsPhotoSourceRow,
} from "@/lib/diagnostics/photoSelection";
import { PHOTO_CATEGORY_LABELS } from "@/lib/status/labels";
import type { PhotoCategory } from "@/lib/database/types";

const IDLE: AssistantActionState = { status: "idle", error: null };

type GridPhoto = {
  photoId: string;
  category: PhotoCategory;
  createdAt: string;
  previewUrl: string | null;
};

type UploadedPhotoMeta = {
  photoId: string;
  category: PhotoCategory;
  createdAt: string;
};

function parseUploadedPhoto(data: unknown): UploadedPhotoMeta | null {
  if (!data || typeof data !== "object") return null;
  const { photoId, category, createdAt } = data as Record<string, unknown>;
  if (typeof photoId !== "string" || typeof category !== "string") return null;
  return {
    photoId,
    category: category as PhotoCategory,
    createdAt: typeof createdAt === "string" ? createdAt : new Date().toISOString(),
  };
}

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
  canMutate,
  preview,
  readOnly,
  disabled = false,
  onBusyChange,
}: {
  thread: { threadId: string; workOrderId: string; jobId: string | null };
  photos: DiagnosticsPhotoSourceRow[];
  selections: DiagnosticsPhotoSelection[];
  onSelectionsChange: Dispatch<SetStateAction<DiagnosticsPhotoSelection[]>>;
  requestedPrompt: string | null;
  canMutate: boolean;
  preview: boolean;
  readOnly: boolean;
  disabled?: boolean;
  onBusyChange?: (busy: boolean) => void;
}) {
  const headingId = useId();
  const cameraInputId = useId();
  const libraryInputId = useId();
  const regionRef = useRef<HTMLDivElement>(null);
  const mountedRef = useRef(true);
  const [registry] = useState(() => createObjectUrlRegistry());
  const [localPhotos, setLocalPhotos] = useState<GridPhoto[]>([]);
  const [uploading, setUploading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cameraProps = photoFileInputProps("camera");
  const libraryProps = photoFileInputProps("library");

  const interactive = canMutate && !preview && !readOnly && !disabled;
  const jobScoped = Boolean(thread.jobId);
  const atLimit = selections.length >= DIAGNOSTICS_PHOTO_MAX_SELECTED;
  const uploadEnabled = interactive && jobScoped && !atLimit && !uploading;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      registry.revokeAll();
    };
  }, [registry]);

  useEffect(() => {
    if (!requestedPrompt || !interactive) return;
    const region = regionRef.current;
    region?.focus();
    region?.scrollIntoView?.({ block: "nearest" });
  }, [requestedPrompt, interactive]);

  const gridPhotos = useMemo<GridPhoto[]>(() => {
    const scope = { workOrderId: thread.workOrderId, jobId: thread.jobId };
    const server = photos
      .filter((photo) => isDiagnosticsPhotoEligible(photo, scope))
      .map((photo) => ({
        photoId: photo.photo_id,
        category: photo.category,
        createdAt: photo.created_at,
        previewUrl: photo.thumb_url ?? null,
      }));
    const serverIds = new Set(server.map((photo) => photo.photoId));
    return [
      ...localPhotos.filter((photo) => !serverIds.has(photo.photoId)),
      ...server,
    ].map((photo) => ({
      ...photo,
      previewUrl: registry.get(photo.photoId) ?? photo.previewUrl,
    }));
    // registry.get is stable; localPhotos changes whenever a preview is added.
  }, [photos, localPhotos, registry, thread.workOrderId, thread.jobId]);

  const byId = useMemo(
    () => new Map(gridPhotos.map((photo) => [photo.photoId, photo])),
    [gridPhotos]
  );
  const defaultPurpose = defaultPhotoPurpose(requestedPrompt);

  function toggle(photoId: string) {
    setNotice(null);
    const isSelected = selections.some((selection) => selection.photoId === photoId);
    if (isSelected) {
      onSelectionsChange((previous) =>
        previous.filter((selection) => selection.photoId !== photoId)
      );
      return;
    }
    onSelectionsChange((previous) => {
      return addPhotoSelection(previous, photoId, defaultPurpose).selections;
    });
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

  async function uploadFromInput(input: HTMLInputElement) {
    setError(null);
    setNotice(null);
    if (!uploadEnabled) {
      input.value = "";
      return;
    }
    const slots = DIAGNOSTICS_PHOTO_MAX_SELECTED - selections.length;
    setBusy(true);
    try {
      const prepared = await readPickedPhotoFiles(input);
      const files = prepared.slice(0, slots);
      if (prepared.length > files.length) {
        setNotice(
          `Only ${DIAGNOSTICS_PHOTO_MAX_SELECTED} photos can be sent per message; extra photos were not uploaded.`
        );
      }
      for (const file of files) {
        const result = await withPhotoUploadRetries(
          () => {
            const form = new FormData();
            form.set("thread_id", thread.threadId);
            form.set("purpose", defaultPurpose);
            form.set("file", file);
            return uploadAssistantPhotoAction(thread.workOrderId, IDLE, form);
          },
          {
            isSuccess: (value) => value.status === "success",
            getFailureMessage: (value) => value.error,
          }
        );
        const uploaded =
          result.status === "success" ? parseUploadedPhoto(result.data) : null;
        if (!uploaded) {
          if (mountedRef.current) {
            setError(result.error ?? "Could not upload that photo. Try again.");
          }
          break;
        }
        if (!mountedRef.current) break;
        const previewUrl = registry.create(file, uploaded.photoId);
        setLocalPhotos((previous) => [
          ...previous.filter((photo) => photo.photoId !== uploaded.photoId),
          { ...uploaded, previewUrl },
        ]);
        onSelectionsChange(
          (previous) =>
            addPhotoSelection(previous, uploaded.photoId, defaultPurpose).selections
        );
      }
    } catch {
      if (mountedRef.current) setError(UNREADABLE_PHOTO_MESSAGE);
    } finally {
      setBusy(false);
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
      <h3 id={headingId} className="text-sm font-semibold">
        Photos for AI analysis
      </h3>
      <p className="text-xs text-[var(--status-neutral)]">
        Only the photos you select here are sent for AI analysis (up to{" "}
        {DIAGNOSTICS_PHOTO_MAX_SELECTED}). Image findings describe visible evidence only
        and need technician verification.
      </p>

      {requestedPrompt ? (
        <p className="rounded bg-amber-50 p-2 text-sm text-amber-900">
          Photo requested: {requestedPrompt}
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
            const selected = selections.some((s) => s.photoId === photo.photoId);
            const label = photoLabel(photo);
            return (
              <li key={photo.photoId}>
                <button
                  type="button"
                  aria-pressed={selected}
                  aria-label={`${selected ? "Deselect" : "Select"} ${label}`}
                  disabled={!interactive || (!selected && atLimit)}
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
                    disabled={!interactive}
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
                    disabled={!interactive}
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

      {interactive && jobScoped ? (
        <div className="flex flex-wrap items-center gap-2">
          <input
            id={cameraInputId}
            type="file"
            accept={cameraProps.accept}
            capture={cameraProps.capture}
            className="photo-file-input"
            tabIndex={-1}
            aria-label="Take a photo with the camera"
            disabled={!uploadEnabled}
            onChange={(event) => void uploadFromInput(event.currentTarget)}
          />
          <input
            id={libraryInputId}
            type="file"
            accept={libraryProps.accept}
            multiple
            className="photo-file-input"
            tabIndex={-1}
            aria-label="Choose photos from the library"
            disabled={!uploadEnabled}
            onChange={(event) => void uploadFromInput(event.currentTarget)}
          />
          <label
            htmlFor={cameraInputId}
            aria-disabled={!uploadEnabled}
            className="btn btn-secondary"
          >
            Camera
          </label>
          <label
            htmlFor={libraryInputId}
            aria-disabled={!uploadEnabled}
            className="btn btn-secondary"
          >
            Library
          </label>
          <span className="text-xs text-[var(--status-neutral)]">{CAMERA_ROLL_HINT}</span>
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
