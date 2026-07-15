"use client";

import { useActionState } from "react";
import type { ProfilePhotoFormState } from "@/app/account/actions";
import { FormError } from "@/components/forms/Field";
import { SubmitButton } from "@/components/forms/SubmitButton";
import { UserAvatar } from "@/components/ui/UserAvatar";

type Action = (
  state: ProfilePhotoFormState,
  formData: FormData
) => Promise<ProfilePhotoFormState>;

const INITIAL: ProfilePhotoFormState = {
  error: null,
  success: null,
  resetKey: 0,
};

export function ProfilePhotoForm({
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

  const success = uploadState.success ?? removeState.success;

  return (
    <div className="flex max-w-md flex-col gap-4 rounded border border-[var(--border)] bg-white p-4">
      <div className="flex items-center gap-4">
        <UserAvatar
          firstName={firstName}
          lastName={lastName}
          photoUrl={photoUrl}
          size="lg"
          className="ring-1 ring-[var(--border)]"
        />
        <div>
          <p className="font-semibold text-foreground">
            {firstName} {lastName}
          </p>
          <p className="mt-1 text-sm text-[var(--status-neutral)]">
            Shown on your account and staff directory.
          </p>
        </div>
      </div>

      <FormError message={uploadState.error ?? removeState.error} />
      {success ? (
        <p
          role="status"
          className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900"
        >
          {success === "updated" ? "Profile photo updated." : "Profile photo removed."}
        </p>
      ) : null}

      <form
        key={uploadState.resetKey}
        action={uploadFormAction}
        encType="multipart/form-data"
        className="flex flex-col gap-3"
      >
        <label htmlFor="profile-photo" className="field-label">
          Choose profile photo
        </label>
        <input
          id="profile-photo"
          name="file"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          required
          className="input h-auto py-2 file:mr-3 file:rounded file:border-0 file:bg-[var(--surface-muted)] file:px-3 file:py-2 file:font-medium"
        />
        <p className="text-sm text-[var(--status-neutral)]">
          JPEG, PNG, or WebP. Maximum 5 MB. Square photos work best.
        </p>
        <div>
          <SubmitButton
            label={photoUrl ? "Replace photo" : "Upload photo"}
            pendingLabel="Uploading…"
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
