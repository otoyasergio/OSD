"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import {
  completeIntakePhotosAction,
  type WorkOrderFormState,
} from "@/app/(app)/work_orders/actions";
import type { PhotoCategory } from "@/lib/database/types";
import { FormError } from "@/components/forms/Field";
import { SubmitButton } from "@/components/forms/SubmitButton";
import {
  IntakePhotoSlots,
  allRequiredIntakeSelected,
  type IntakePhotoSelection,
} from "@/components/forms/IntakePhotoSlots";

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
  const boundAction = completeIntakePhotosAction.bind(null, workOrderId);

  const [state, formAction] = useActionState(boundAction, {
    error: initialError ?? null,
    workOrderId,
    workOrderNumber,
    missingCategories,
  } satisfies WorkOrderFormState);

  const [intakePhotos, setIntakePhotos] = useState<IntakePhotoSelection>({});
  const [clientError, setClientError] = useState<string | null>(null);

  const categories =
    state.missingCategories && state.missingCategories.length > 0
      ? state.missingCategories
      : missingCategories;

  return (
    <form
      action={formAction}
      encType="multipart/form-data"
      className="flex max-w-3xl flex-col gap-6"
      onSubmit={(event) => {
        if (!allRequiredIntakeSelected(intakePhotos, categories)) {
          event.preventDefault();
          setClientError("Add all remaining intake photos before continuing.");
        }
      }}
    >
      <FormError message={state.error ?? clientError} />

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
          categories={categories}
          value={intakePhotos}
          onChange={(next) => {
            setIntakePhotos(next);
            setClientError(null);
          }}
        />
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton
          label="Upload remaining photos"
          pendingLabel="Uploading…"
        />
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
