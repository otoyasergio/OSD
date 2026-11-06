"use client";

import { useActionState, useState } from "react";
import type { CustomerPhotoFormState } from "@/app/(app)/customers/photo-actions";
import { FormError } from "@/components/forms/Field";
import { PreparedFileInput } from "@/components/forms/PreparedFileInput";
import { SubmitButton } from "@/components/forms/SubmitButton";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { IMAGE_ACCEPT } from "@/lib/forms/photoSourceInputs";
import { photoTooLargeMessage } from "@/lib/forms/photoUploadErrors";
import {
  SERVER_ACTION_UPLOAD_MAX_BYTES,
  exceedsServerActionUploadLimit,
  formatMegabytes,
} from "@/lib/forms/uploadLimits";

type Action = (
  state: CustomerPhotoFormState,
  formData: FormData
) => Promise<CustomerPhotoFormState>;

const INITIAL: CustomerPhotoFormState = {
  error: null,
  success: null,
  resetKey: 0,
};

export function CustomerPhotoForm({
  firstName,
  lastName,
  photoUrl,
  uploadAction,
  removeAction,
}: {
  firstName: string;
  lastName: string;
  photoUrl: string | null;
  uploadAction: Action;
  removeAction: Action;
}) {
  const [uploadState, uploadFormAction] = useActionState(uploadAction, INITIAL);
  const [removeState, removeFormAction] = useActionState(removeAction, INITIAL);
  const [preparing, setPreparing] = useState(false);
  const [sizeError, setSizeError] = useState<string | null>(null);
  const success = uploadState.success ?? removeState.success;

  return (
    <div className="flex w-full max-w-xs flex-col gap-3">
      <UserAvatar
        firstName={firstName}
        lastName={lastName}
        photoUrl={photoUrl}
        size="lg"
        className="ring-1 ring-[var(--border)]"
      />
      <FormError message={sizeError ?? uploadState.error ?? removeState.error} />
      {success ? (
        <p
          role="status"
          className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900"
        >
          {success === "updated" ? "Customer photo updated." : "Customer photo removed."}
        </p>
      ) : null}
      <form
        key={uploadState.resetKey}
        action={uploadFormAction}
        className="flex flex-col gap-2"
        onSubmit={(event) => {
          const file = event.currentTarget.elements.namedItem("file");
          const picked = file instanceof HTMLInputElement ? file.files?.[0] : undefined;
          if (picked && exceedsServerActionUploadLimit(picked)) {
            event.preventDefault();
            setSizeError(photoTooLargeMessage(picked));
            return;
          }
          setSizeError(null);
        }}
      >
        <label htmlFor="customer-photo" className="field-label">
          Customer photo
        </label>
        <PreparedFileInput
          id="customer-photo"
          name="file"
          accept={IMAGE_ACCEPT}
          required
          surface="customer_photo"
          onPreparingChange={setPreparing}
        />
        <p className="text-sm text-[var(--status-neutral)]">
          JPEG, PNG, WebP, or iPhone photo up to{" "}
          {formatMegabytes(SERVER_ACTION_UPLOAD_MAX_BYTES)}. Staff only.
        </p>
        <div>
          <SubmitButton
            label={photoUrl ? "Replace photo" : "Add photo"}
            pendingLabel="Uploading…"
            disabled={preparing}
          />
        </div>
      </form>
      {photoUrl ? (
        <form action={removeFormAction}>
          <SubmitButton
            label="Remove photo"
            pendingLabel="Removing…"
            variant="secondary"
          />
        </form>
      ) : null}
    </div>
  );
}
