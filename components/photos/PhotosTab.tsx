"use client";

import { useActionState, useMemo, useState } from "react";
import type { IntakePhoto } from "@/lib/services/photos";
import type { PhotoCategory } from "@/lib/database/types";
import type { PhotoFormState } from "@/app/(app)/work_orders/photo-actions";
import {
  PHOTO_CATEGORY_LABELS,
  REQUIRED_PHOTO_CATEGORIES,
} from "@/lib/status/labels";
import { FormError, TextField } from "@/components/forms/Field";
import { SubmitButton } from "@/components/forms/SubmitButton";

type Action = (
  state: PhotoFormState,
  formData: FormData
) => Promise<PhotoFormState>;

const SELECT_CLASS =
  "min-h-11 w-full rounded border border-zinc-300 bg-white px-3 py-2 text-base text-zinc-900 outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10";

const ALL_CATEGORIES = Object.keys(PHOTO_CATEGORY_LABELS) as PhotoCategory[];

export function PhotosTab({
  photos,
  readOnly,
  canUpload,
  uploadAction,
}: {
  photos: IntakePhoto[];
  readOnly: boolean;
  canUpload: boolean;
  uploadAction: Action;
}) {
  const [uploadState, uploadFormAction] = useActionState(uploadAction, {
    error: null,
  });
  const [filter, setFilter] = useState<PhotoCategory | "all">("all");

  const covered = useMemo(() => {
    const set = new Set(photos.map((p) => p.category));
    return set;
  }, [photos]);

  const missingRequired = REQUIRED_PHOTO_CATEGORIES.filter(
    (c) => !covered.has(c)
  );

  const visible =
    filter === "all" ? photos : photos.filter((p) => p.category === filter);

  return (
    <div className="flex flex-col gap-4">
      {missingRequired.length > 0 ? (
        <div
          role="status"
          className="rounded border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950"
        >
          <p className="font-medium">Required intake angles still missing:</p>
          <p className="mt-1">
            {missingRequired
              .map((c) => PHOTO_CATEGORY_LABELS[c])
              .join(", ")}
          </p>
        </div>
      ) : photos.length > 0 ? (
        <p className="text-sm text-zinc-600">
          All required intake categories are covered.
        </p>
      ) : null}

      {!readOnly && canUpload ? (
        <form
          action={uploadFormAction}
          className="flex flex-col gap-3 rounded border border-zinc-200 bg-white p-4"
          encType="multipart/form-data"
        >
          <h3 className="text-base font-semibold text-zinc-900">
            Upload intake photo
          </h3>
          <FormError message={uploadState.error} />
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-zinc-800">
              Category <span className="text-red-600">*</span>
            </span>
            <select
              className={SELECT_CLASS}
              name="category"
              required
              defaultValue={missingRequired[0] ?? "front"}
            >
              {ALL_CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {PHOTO_CATEGORY_LABELS[category]}
                  {REQUIRED_PHOTO_CATEGORIES.includes(category) &&
                  !covered.has(category)
                    ? " (needed)"
                    : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-zinc-800">
              Photo <span className="text-red-600">*</span>
            </span>
            <input
              className={SELECT_CLASS}
              type="file"
              name="file"
              accept="image/jpeg,image/png,image/webp,image/heic,image/heif,image/*"
              required
            />
          </label>
          <TextField label="Notes" name="notes" />
          <div>
            <SubmitButton label="Upload photo" pendingLabel="Uploading…" />
          </div>
        </form>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <label className="text-sm font-medium text-zinc-800" htmlFor="photo-filter">
          Filter
        </label>
        <select
          id="photo-filter"
          className={`${SELECT_CLASS} w-auto min-w-40`}
          value={filter}
          onChange={(e) =>
            setFilter(e.target.value as PhotoCategory | "all")
          }
        >
          <option value="all">All categories</option>
          {ALL_CATEGORIES.map((category) => (
            <option key={category} value={category}>
              {PHOTO_CATEGORY_LABELS[category]}
            </option>
          ))}
        </select>
        <span className="text-sm text-zinc-500">
          {visible.length} photo{visible.length === 1 ? "" : "s"}
        </span>
      </div>

      {visible.length === 0 ? (
        <p className="rounded border border-dashed border-zinc-300 bg-white px-4 py-10 text-center text-zinc-600">
          {photos.length === 0
            ? "No intake photos yet. Upload angles of the bike before work begins."
            : "No photos in this category."}
        </p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((photo) => (
            <li
              key={photo.photo_id}
              className="overflow-hidden rounded border border-zinc-200 bg-white"
            >
              {photo.signed_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={photo.signed_url}
                  alt={`${PHOTO_CATEGORY_LABELS[photo.category]} intake photo`}
                  className="aspect-[4/3] w-full object-cover bg-zinc-100"
                />
              ) : (
                <div className="flex aspect-[4/3] items-center justify-center bg-zinc-100 text-sm text-zinc-500">
                  Preview unavailable
                </div>
              )}
              <div className="space-y-1 p-3 text-sm">
                <p className="font-medium text-zinc-900">
                  {PHOTO_CATEGORY_LABELS[photo.category]}
                </p>
                <p className="text-zinc-500">
                  {new Date(photo.created_at).toLocaleString()}
                  {photo.uploaded_by
                    ? ` · ${photo.uploaded_by.first_name} ${photo.uploaded_by.last_name}`
                    : ""}
                </p>
                {photo.notes ? (
                  <p className="text-zinc-700">{photo.notes}</p>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
