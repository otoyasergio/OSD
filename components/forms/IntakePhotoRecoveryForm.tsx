"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { PhotoCategory } from "@/lib/database/types";
import { FormError } from "@/components/forms/Field";
import {
  IntakePhotoSlots,
  type IntakePhotoSelection,
} from "@/components/forms/IntakePhotoSlots";
import { usePhotoUploadQueue } from "@/components/photos/PhotoUploadQueueProvider";
import {
  intakeContractHref,
  labelsForRecoveryWaitFailure,
  requiredQueueIdsForRemainingCategories,
} from "@/lib/photos/intakeQueue";
import { PHOTO_CATEGORY_LABELS } from "@/lib/status/labels";
import { toFormErrorMessage } from "@/lib/services/errors";

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
  const queue = usePhotoUploadQueue();
  const [submitting, setSubmitting] = useState(false);
  const [intakePhotos, setIntakePhotos] = useState<IntakePhotoSelection>({});
  const [clientError, setClientError] = useState<string | null>(initialError ?? null);
  const [remaining, setRemaining] = useState<PhotoCategory[]>(missingCategories);
  const preferredIdsRef = useRef<Partial<Record<string, string>>>({});

  useEffect(() => {
    const liveIds = new Set<string>();
    for (const item of queue.items) {
      if (item.workOrderId === workOrderId) liveIds.add(item.queueId);
    }
    for (const receipt of queue.confirmations) {
      if (receipt.workOrderId === workOrderId) liveIds.add(receipt.queueId);
    }
    for (const [category, queueId] of Object.entries(preferredIdsRef.current)) {
      if (!queueId || !liveIds.has(queueId)) {
        delete preferredIdsRef.current[category];
      }
    }
    for (const item of queue.items) {
      if (item.workOrderId !== workOrderId) continue;
      preferredIdsRef.current[item.category] = item.queueId;
    }
  }, [queue.confirmations, queue.items, workOrderId]);

  const readiness = useMemo(
    () =>
      requiredQueueIdsForRemainingCategories({
        remaining,
        workOrderId,
        items: queue.items,
        receipts: queue.confirmations,
      }),
    [queue.confirmations, queue.items, remaining, workOrderId]
  );
  const failedRequired = remaining.filter((category) =>
    queue.items.some(
      (item) =>
        item.workOrderId === workOrderId &&
        item.category === category &&
        item.status === "failed"
    )
  );
  const selectedCount = remaining.filter((category) => {
    if (failedRequired.includes(category)) return false;
    return !readiness.missingCategories.includes(category);
  }).length;
  const allSelected =
    failedRequired.length === 0 &&
    readiness.missingCategories.length === 0 &&
    readiness.queueIds.length === remaining.length;

  async function waitForRemaining() {
    setClientError(null);
    setSubmitting(true);
    try {
      const liveIds = new Set<string>();
      for (const item of queue.items) {
        if (item.workOrderId === workOrderId) liveIds.add(item.queueId);
      }
      for (const receipt of queue.confirmations) {
        if (receipt.workOrderId === workOrderId) liveIds.add(receipt.queueId);
      }
      for (const [category, queueId] of Object.entries(preferredIdsRef.current)) {
        if (!queueId || !liveIds.has(queueId)) {
          delete preferredIdsRef.current[category];
        }
      }
      for (const item of queue.items) {
        if (item.workOrderId !== workOrderId) continue;
        preferredIdsRef.current[item.category] = item.queueId;
      }
      const { queueIds: requiredQueueIds, missingCategories: stillMissing } =
        requiredQueueIdsForRemainingCategories({
          remaining,
          workOrderId,
          items: queue.items,
          receipts: queue.confirmations,
          preferredByCategory: preferredIdsRef.current,
        });
      if (stillMissing.length > 0 || requiredQueueIds.length !== remaining.length) {
        const labels = stillMissing
          .map((category) => PHOTO_CATEGORY_LABELS[category as PhotoCategory] ?? category)
          .join(", ");
        setClientError(
          `${toFormErrorMessage(new Error("INTAKE_PHOTOS_PARTIAL"))} Missing: ${labels}.`
        );
        return;
      }
      const waited = await queue.waitForConfirmations(requiredQueueIds);

      if (!waited.ok) {
        const failedCategories = labelsForRecoveryWaitFailure({
          remaining,
          requiredQueueIds,
          waited,
        }).filter((category): category is PhotoCategory =>
          remaining.includes(category as PhotoCategory)
        );
        setRemaining(failedCategories.length > 0 ? failedCategories : remaining);
        const labels = (failedCategories.length > 0 ? failedCategories : remaining)
          .map((category) => PHOTO_CATEGORY_LABELS[category] ?? category)
          .join(", ");
        setClientError(
          `${toFormErrorMessage(new Error("INTAKE_PHOTOS_PARTIAL"))} Missing: ${labels}.`
        );
        return;
      }

      router.push(intakeContractHref(workOrderId));
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
        if (!allSelected) {
          setClientError("Add all remaining intake photos before continuing.");
          return;
        }
        void waitForRemaining();
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
              {selectedCount}/{remaining.length}
            </span>
            {allSelected
              ? "Ready to continue"
              : failedRequired.length > 0
                ? "Retry"
                : "remaining"}
          </div>
        </div>
        <IntakePhotoSlots
          categories={remaining}
          value={intakePhotos}
          workOrderId={workOrderId}
          htmlRequired={!allSelected}
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
          {submitting
            ? "Uploading…"
            : allSelected
              ? "Continue"
              : "Upload remaining photos"}
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
