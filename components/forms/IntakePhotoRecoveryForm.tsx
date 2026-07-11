"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { uploadIntakePhotoAction } from "@/app/(app)/work_orders/photo-actions";
import type { PhotoCategory } from "@/lib/database/types";
import { FormError } from "@/components/forms/Field";
import {
  IntakePhotoSlots,
  allRequiredIntakeSelected,
  type IntakePhotoSelection,
} from "@/components/forms/IntakePhotoSlots";
import { compressImageForUpload } from "@/lib/forms/compressImageForUpload";
import { toFormErrorMessage } from "@/lib/services/errors";
import { PHOTO_CATEGORY_LABELS } from "@/lib/status/labels";

export function IntakePhotoRecoveryForm({
  workOrderId,
  workOrderNumber,
  missingCategories,
  initialError,
}: {
  workOrderId: string;
  workOrderNumber?: string | null;
  missingCategories: PhotoCategory[];
  initialError?: string | null;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [intakePhotos, setIntakePhotos] = useState<IntakePhotoSelection>({});
  const [clientError, setClientError] = useState<string | null>(
    initialError ?? null
  );
  const [remaining, setRemaining] =
    useState<PhotoCategory[]>(missingCategories);

  async function uploadRemaining() {
    setClientError(null);
    setSubmitting(true);
    const failed: PhotoCategory[] = [];

    try {
      for (const category of remaining) {
        const original = intakePhotos[category];
        if (!(original instanceof File) || original.size === 0) {
          failed.push(category);
          continue;
        }

        try {
          const file = await compressImageForUpload(original);
          const photoData = new FormData();
          photoData.set("file", file);
          photoData.set("category", category);
          const uploaded = await uploadIntakePhotoAction(
            workOrderId,
            { error: null },
            photoData
          );
          if (uploaded.error) failed.push(category);
        } catch {
          failed.push(category);
        }
      }

      if (failed.length > 0) {
        setRemaining(failed);
        const labels = failed
          .map((c) => PHOTO_CATEGORY_LABELS[c] ?? c)
          .join(", ");
        setClientError(
          `${toFormErrorMessage(new Error("INTAKE_PHOTOS_PARTIAL"))} Missing: ${labels}.`
        );
        setIntakePhotos({});
        return;
      }

      router.push(`/work_orders/${workOrderId}`);
      router.refresh();
    } catch (error) {
      setClientError(toFormErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      encType="multipart/form-data"
      className="flex max-w-3xl flex-col gap-6"
      onSubmit={(event) => {
        event.preventDefault();
        if (!allRequiredIntakeSelected(intakePhotos, remaining)) {
          setClientError("Add all remaining intake photos before continuing.");
          return;
        }
        void uploadRemaining();
      }}
    >
      <FormError message={clientError} />

      <section className="flex flex-col gap-3 rounded border border-amber-200 bg-amber-50 px-4 py-4">
        <h2 className="text-lg font-semibold text-zinc-900">
          Finish intake photos
        </h2>
        <p className="text-sm text-amber-950">
          Work order{" "}
          <span className="font-medium">
            {workOrderNumber || workOrderId}
          </span>{" "}
          was created, but some required photos did not upload. Add the missing
          photos below to continue.
        </p>
        <IntakePhotoSlots
          categories={remaining}
          value={intakePhotos}
          onChange={(next) => {
            setIntakePhotos(next);
            setClientError(null);
          }}
        />
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={submitting}
          className="btn btn-primary min-h-12 min-w-[8rem] px-6 text-base disabled:opacity-60 sm:min-h-14 sm:text-lg"
        >
          {submitting ? "Uploading…" : "Upload remaining photos"}
        </button>
        <Link
          href={`/work_orders/${workOrderId}?tab=photos`}
          className="text-sm text-zinc-600 underline-offset-2 hover:underline"
        >
          Open work order Photos tab
        </Link>
      </div>
    </form>
  );
}
