"use client";

import { useActionState, useState } from "react";
import type { ProfilePhotoFormState } from "@/app/account/actions";
import { FormError } from "@/components/forms/Field";
import { PreparedFileInput } from "@/components/forms/PreparedFileInput";
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
  const [preparing, setPreparing] = useState(false);

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
        <PreparedFileInput
          id="profile-photo"
          name="file"
          accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
          required
          surface="profile"
          onPreparingChange={setPreparing}
        />
        <p className="text-sm text-[var(--status-neutral)]">
          JPEG, PNG, WebP, or iPhone photo. Maximum 5 MB. Square photos work best.
        </p>
        <div>
          <SubmitButton
            label={photoUrl ? "Replace photo" : "Upload photo"}
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
