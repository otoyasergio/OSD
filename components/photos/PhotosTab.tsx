"use client";

import { useActionState, useEffect, useId, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { IntakePhoto } from "@/lib/services/photos";
import type { PhotoCategory } from "@/lib/database/types";
import type { PhotoFormState } from "@/app/(app)/work_orders/photo-actions";
import {
  GENERAL_WORK_ORDER_PHOTO_CATEGORIES,
  PHOTO_CATEGORY_LABELS,
  REQUIRED_PHOTO_CATEGORIES,
} from "@/lib/status/labels";
import { FormError } from "@/components/forms/Field";
import { usePhotoUploadQueue } from "@/components/photos/PhotoUploadQueueProvider";
import { UNREADABLE_PHOTO_MESSAGE } from "@/lib/forms/photoUploadErrors";
import { CAMERA_ROLL_HINT, photoFileInputProps } from "@/lib/forms/photoSourceInputs";
import { PhotoQueuePersistenceError } from "@/lib/photos/uploadQueue/errors";
import { photoQueueStatusLabel } from "@/lib/photos/uploadQueue/statusCopy";
import { readPickedPhotoFiles } from "@/lib/forms/readPickedPhotoFiles";
import { formatDateTime } from "@/lib/datetime/format";
import { toLightboxPhotos } from "@/lib/photos/lightbox";
import { PhotoLightbox } from "@/components/photos/PhotoLightbox";

type Action = (state: PhotoFormState, formData: FormData) => Promise<PhotoFormState>;

const SELECT_CLASS =
  "min-h-11 w-full rounded border border-[var(--border-strong)] bg-white px-3 py-2 text-base text-foreground outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-ring)]";

const UPLOAD_CATEGORIES = GENERAL_WORK_ORDER_PHOTO_CATEGORIES;

export function PhotosTab({
  photos,
  readOnly,
  canUpload,
  canDelete,
  workOrderId,
  deleteAction,
}: {
  photos: IntakePhoto[];
  readOnly: boolean;
  canUpload: boolean;
  canDelete: boolean;
  workOrderId: string;
  deleteAction: Action;
}) {
  const queue = usePhotoUploadQueue();
  const router = useRouter();
  const titleId = useId();
  const cameraInputId = useId();
  const libraryInputId = useId();
  const defaultCategory =
    REQUIRED_PHOTO_CATEGORIES.find(
      (category) => !photos.some((photo) => photo.category === category)
    ) ?? "front";
  const categoryRef = useRef<PhotoCategory>(defaultCategory);
  const notesRef = useRef("");
  const refreshedIds = useRef(new Set<string>());
  const [deleteState, deleteFormAction, deletePending] = useActionState(deleteAction, {
    error: null,
  });
  const [filter, setFilter] = useState<PhotoCategory | "all">("all");
  const [chooserOpen, setChooserOpen] = useState(false);
  const [lightboxPhotoId, setLightboxPhotoId] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [pickError, setPickError] = useState<string | null>(null);

  const cameraProps = photoFileInputProps("camera");
  const libraryProps = photoFileInputProps("library");

  const covered = useMemo(() => {
    const set = new Set(photos.map((p) => p.category));
    return set;
  }, [photos]);

  const missingRequired = REQUIRED_PHOTO_CATEGORIES.filter((c) => !covered.has(c));

  const visible = filter === "all" ? photos : photos.filter((p) => p.category === filter);

  const lightboxPhotos = useMemo(() => toLightboxPhotos(visible), [visible]);
  const lightboxIndex = lightboxPhotoId
    ? lightboxPhotos.findIndex((p) => p.id === lightboxPhotoId)
    : -1;

  useEffect(() => {
    return queue.subscribeConfirmation((confirmation) => {
      if (refreshedIds.current.has(confirmation.queueId)) return;
      const matches =
        queue.confirmations.some(
          (receipt) =>
            receipt.queueId === confirmation.queueId &&
            receipt.workOrderId === workOrderId
        ) ||
        queue.items.some(
          (item) =>
            item.queueId === confirmation.queueId && item.workOrderId === workOrderId
        );
      if (!matches) return;
      refreshedIds.current.add(confirmation.queueId);
      router.refresh();
    });
  }, [queue, router, workOrderId]);

  useEffect(() => {
    for (const receipt of queue.confirmations) {
      if (receipt.workOrderId !== workOrderId || !receipt.photoId) continue;
      if (photos.some((photo) => photo.photo_id === receipt.photoId)) continue;
      if (refreshedIds.current.has(receipt.queueId)) continue;
      refreshedIds.current.add(receipt.queueId);
      router.refresh();
    }
  }, [photos, queue.confirmations, router, workOrderId]);

  async function applyPickedFile(input: HTMLInputElement) {
    setChooserOpen(false);
    setPickError(null);
    setPreparing(true);
    try {
      const files = await readPickedPhotoFiles(input);
      const file = files[0] ?? null;
      if (!file) return;
      const form = input.form;
      const formData = form ? new FormData(form) : null;
      const category = String(
        formData?.get("category") || categoryRef.current || "front"
      );
      const notes = String(formData?.get("notes") ?? notesRef.current).trim();
      categoryRef.current = category as PhotoCategory;
      notesRef.current = notes;
      await queue.enqueue({
        file,
        category,
        workOrderId,
        notes: notes || undefined,
      });
    } catch (error) {
      if (error instanceof PhotoQueuePersistenceError) {
        setPickError(error.message);
      } else {
        setPickError(UNREADABLE_PHOTO_MESSAGE);
      }
    } finally {
      setPreparing(false);
    }
  }

  const queuedHere = queue.items.filter((item) => item.workOrderId === workOrderId);

  return (
    <div className="flex flex-col gap-4">
      {missingRequired.length > 0 ? (
        <div
          role="status"
          className="rounded border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950"
        >
          <p className="font-medium">Required intake angles still missing:</p>
          <p className="mt-1">
            {missingRequired.map((c) => PHOTO_CATEGORY_LABELS[c]).join(", ")}
          </p>
        </div>
      ) : photos.length > 0 ? (
        <p className="text-sm text-[var(--status-neutral)]">
          All required intake categories are covered.
        </p>
      ) : null}

      {!readOnly && canUpload ? (
        <form
          className="relative flex flex-col gap-3 rounded border border-[var(--border)] bg-white p-4"
          onSubmit={(event) => {
            event.preventDefault();
          }}
        >
          <h3 className="text-base font-semibold text-foreground">Upload intake photo</h3>
          <FormError message={pickError} />
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-foreground">
              Category <span className="text-red-600">*</span>
            </span>
            <select
              className={SELECT_CLASS}
              name="category"
              required
              defaultValue={missingRequired[0] ?? "front"}
              onChange={(event) => {
                categoryRef.current = event.target.value as PhotoCategory;
              }}
            >
              {UPLOAD_CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {PHOTO_CATEGORY_LABELS[category]}
                  {REQUIRED_PHOTO_CATEGORIES.includes(category) && !covered.has(category)
                    ? " (needed)"
                    : ""}
                </option>
              ))}
            </select>
          </label>
          <div className="relative block">
            <span className="mb-1.5 block text-sm font-medium text-foreground">
              Photo <span className="text-red-600">*</span>
            </span>
            <input
              id={cameraInputId}
              className="photo-file-input"
              type="file"
              accept={cameraProps.accept}
              capture={cameraProps.capture}
              tabIndex={-1}
              aria-label="Camera"
              onChange={(event) => void applyPickedFile(event.currentTarget)}
            />
            <input
              id={libraryInputId}
              className="photo-file-input"
              type="file"
              accept={libraryProps.accept}
              tabIndex={-1}
              aria-label="Photo library"
              onChange={(event) => void applyPickedFile(event.currentTarget)}
            />
            <div className="flex flex-col gap-2 sm:flex-row">
              <button
                type="button"
                className="btn btn-secondary min-h-11 flex-1"
                onClick={() => setChooserOpen(true)}
                disabled={preparing}
              >
                {preparing ? "Preparing photo…" : "Choose photo"}
              </button>
            </div>
            <p className="mt-1.5 text-sm text-[var(--status-neutral)]">
              {preparing
                ? "Preparing photo — keep this screen open."
                : "Camera or Library — the photo queues as soon as you choose it."}
            </p>
          </div>
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-foreground">
              Notes
            </span>
            <input
              className={SELECT_CLASS}
              name="notes"
              onChange={(event) => {
                notesRef.current = event.target.value.trim();
              }}
            />
          </label>
          {queuedHere.map((item) => (
            <p
              key={item.queueId}
              role="status"
              className="text-sm text-[var(--status-neutral)]"
            >
              {photoQueueStatusLabel(item, queue.isOnline())}
            </p>
          ))}
        </form>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <label className="text-sm font-medium text-foreground" htmlFor="photo-filter">
          Filter
        </label>
        <select
          id="photo-filter"
          className={`${SELECT_CLASS} w-auto min-w-40`}
          value={filter}
          onChange={(e) => setFilter(e.target.value as PhotoCategory | "all")}
        >
          <option value="all">All categories</option>
          {UPLOAD_CATEGORIES.map((category) => (
            <option key={category} value={category}>
              {PHOTO_CATEGORY_LABELS[category]}
            </option>
          ))}
        </select>
        <span className="text-sm text-[var(--status-neutral)]">
          {visible.length} photo{visible.length === 1 ? "" : "s"}
        </span>
      </div>

      <FormError message={deleteState.error} />

      {visible.length === 0 ? (
        <div className="empty-state">
          <svg className="empty-state-icon" viewBox="0 0 64 48" aria-hidden>
            <rect
              x="10"
              y="12"
              width="44"
              height="28"
              rx="3"
              fill="currentColor"
              opacity="0.12"
            />
            <circle cx="24" cy="22" r="4" fill="currentColor" opacity="0.35" />
            <path d="M14 34l10-10 8 8 6-6 12 8H14z" fill="currentColor" opacity="0.3" />
          </svg>
          <p>
            {photos.length === 0
              ? "No intake photos yet. Upload angles of the bike before work begins."
              : "No photos in this category."}
          </p>
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((photo) => (
            <li
              key={photo.photo_id}
              className="overflow-hidden rounded border border-[var(--border)] bg-white"
            >
              {photo.thumb_url || photo.signed_url ? (
                <button
                  type="button"
                  className="block w-full cursor-zoom-in p-0 focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
                  aria-label={`View ${PHOTO_CATEGORY_LABELS[photo.category]} photo full size`}
                  onClick={() => setLightboxPhotoId(photo.photo_id)}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={photo.thumb_url ?? photo.signed_url ?? ""}
                    alt={`${PHOTO_CATEGORY_LABELS[photo.category]} intake photo`}
                    className="aspect-[4/3] w-full object-cover bg-[var(--surface-muted)]"
                  />
                </button>
              ) : (
                <div className="flex aspect-[4/3] items-center justify-center bg-[var(--surface-muted)] text-sm text-[var(--status-neutral)]">
                  Preview unavailable
                </div>
              )}
              <div className="space-y-2 p-3 text-sm">
                <p className="font-medium text-foreground">
                  {PHOTO_CATEGORY_LABELS[photo.category]}
                </p>
                <p className="text-[var(--status-neutral)]">
                  {formatDateTime(photo.created_at)}
                  {photo.uploaded_by
                    ? ` · ${photo.uploaded_by.first_name} ${photo.uploaded_by.last_name}`
                    : ""}
                </p>
                {photo.notes ? <p className="text-foreground">{photo.notes}</p> : null}
                {!readOnly && canDelete ? (
                  <form action={deleteFormAction}>
                    <input type="hidden" name="photo_id" value={photo.photo_id} />
                    <button
                      type="submit"
                      className="btn btn-ghost min-h-10 w-full text-red-700 hover:bg-red-50"
                      disabled={deletePending}
                      aria-label={`Remove ${PHOTO_CATEGORY_LABELS[photo.category]} photo`}
                    >
                      {deletePending ? "Removing…" : "Remove photo"}
                    </button>
                  </form>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      {lightboxIndex >= 0 ? (
        <PhotoLightbox
          photos={lightboxPhotos}
          initialIndex={lightboxIndex}
          onClose={() => setLightboxPhotoId(null)}
        />
      ) : null}

      {chooserOpen ? (
        <div
          className="photo-source-sheet"
          role="presentation"
          onClick={() => setChooserOpen(false)}
        >
          <div
            className="photo-source-sheet-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            onClick={(event) => event.stopPropagation()}
          >
            <p id={titleId} className="photo-source-sheet-title">
              Add photo
            </p>
            <p className="photo-source-sheet-lede">
              Use the camera, or choose an existing photo from your library.{" "}
              {CAMERA_ROLL_HINT}
            </p>
            <label
              htmlFor={cameraInputId}
              className="btn btn-primary photo-source-sheet-action"
            >
              Camera
            </label>
            <label
              htmlFor={libraryInputId}
              className="btn btn-secondary photo-source-sheet-action"
            >
              Library
            </label>
            <button
              type="button"
              className="btn btn-ghost photo-source-sheet-cancel"
              onClick={() => setChooserOpen(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
