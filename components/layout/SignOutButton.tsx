"use client";

import { useTransition } from "react";
import { signOutAction } from "@/app/(app)/actions/sign-out";

export function SignOutButton() {
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      className="btn btn-secondary text-sm"
      disabled={pending}
      aria-busy={pending}
      onClick={() => startTransition(() => signOutAction())}
    >
      {pending ? "Signing out…" : "Sign out"}
    </button>
  );
}
