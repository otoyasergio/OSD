"use client";

import { useTransition } from "react";
import { signOutAction } from "@/app/(app)/actions/sign-out";
import { useOptionalPhotoUploadQueue } from "@/components/photos/PhotoUploadQueueProvider";
import { PHOTO_QUEUE_SIGNOUT_WARNING } from "@/lib/photos/uploadQueue/statusCopy";

export function SignOutButton() {
  const [pending, startTransition] = useTransition();
  const queue = useOptionalPhotoUploadQueue();

  return (
    <button
      type="button"
      className="btn btn-secondary text-sm"
      disabled={pending}
      aria-busy={pending}
      onClick={() => {
        if (queue && queue.items.length > 0) {
          const confirmed = window.confirm(PHOTO_QUEUE_SIGNOUT_WARNING);
          if (!confirmed) return;
        }
        startTransition(() => signOutAction());
      }}
    >
      {pending ? "Signing out…" : "Sign out"}
    </button>
  );
}
