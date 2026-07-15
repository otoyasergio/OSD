"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { PhotoCategory } from "@/lib/database/types";
import { FormError } from "@/components/forms/Field";
import {
  IntakePhotoSlots,
  allRequiredIntakeSelected,
  type IntakePhotoSelection,
} from "@/components/forms/IntakePhotoSlots";
import {
  intakeContractHref,
  uploadOptionalIntakePhotos,
  uploadSelectedIntakePhoto,
} from "@/components/forms/intakePhotoUploadClient";
import { toFormErrorMessage } from "@/lib/services/errors";
import { PHOTO_CATEGORY_LABELS } from "@/lib/status/labels";

export function IntakePhotoRecoveryForm({
  workOrderId,
  workOrderNumber,
  missingCategories,
  initialError,
  optionalPhotos = [],
}: {
  workOrderId: string;
  workOrderNumber?: string | null;
  missingCategories: PhotoCategory[];
  initialError?: string | null;
  optionalPhotos?: File[];
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [intakePhotos, setIntakePhotos] = useState<IntakePhotoSelection>({});
  const [clientError, setClientError] = useState<string | null>(initialError ?? null);
  const [remaining, setRemaining] = useState<PhotoCategory[]>(missingCategories);

  const selectedCount = Object.values(intakePhotos).filter(
    (file) => file instanceof File && file.size > 0
  ).length;
  const needed = remaining.length;
  const allSelected = allRequiredIntakeSelected(intakePhotos, remaining);

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

        const uploaded = await uploadSelectedIntakePhoto(workOrderId, original, category);
        if (!uploaded) failed.push(category);
      }

      if (failed.length > 0) {
        setRemaining(failed);
        const labels = failed.map((c) => PHOTO_CATEGORY_LABELS[c] ?? c).join(", ");
        setClientError(
          `${toFormErrorMessage(new Error("INTAKE_PHOTOS_PARTIAL"))} Missing: ${labels}.`
        );
        setIntakePhotos({});
        return;
      }

      const optionalFailures = await uploadOptionalIntakePhotos(
        workOrderId,
        optionalPhotos
      );
      router.push(intakeContractHref(workOrderId, optionalFailures));
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
      className="intake-wizard"
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

      <section className="intake-recovery">
        <div className="intake-photo-header">
          <div>
            <h2 className="intake-recovery-title">Finish intake photos</h2>
            <p className="intake-recovery-body mt-1">
              Work order{" "}
              <span className="font-medium">{workOrderNumber || workOrderId}</span> was
              created, but some required photos did not upload. Add the missing photos
              below to continue.
            </p>
          </div>
          <div
            className={`intake-photo-progress${allSelected ? " is-complete" : ""}`}
            role="status"
            aria-live="polite"
          >
            <span className="intake-photo-progress-meter">
              {selectedCount}/{needed}
            </span>
            {allSelected ? "Ready to upload" : "remaining"}
          </div>
        </div>
        <IntakePhotoSlots
          categories={remaining}
          value={intakePhotos}
          onChange={(next) => {
            setIntakePhotos(next);
            setClientError(null);
          }}
        />
      </section>

      <div className="intake-wizard-nav">
        <button
          type="submit"
          disabled={submitting}
          className="btn btn-primary min-h-12 min-w-[8rem] px-6 text-base disabled:opacity-60 sm:min-h-14 sm:text-lg"
        >
          {submitting ? "Uploading…" : "Upload remaining photos"}
        </button>
        <Link
          href={`/work_orders/${workOrderId}?tab=photos`}
          className="text-sm text-[var(--status-neutral)] underline-offset-2 hover:underline"
        >
          Open work order Photos tab
        </Link>
      </div>
    </form>
  );
}
