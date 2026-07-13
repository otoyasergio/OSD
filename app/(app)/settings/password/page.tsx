import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentAppUser } from "@/lib/auth/session";
import { canChangeOwnPassword } from "@/lib/permissions";
import { ChangePasswordForm } from "@/components/forms/ChangePasswordForm";
import { changeOwnPasswordAction } from "@/app/(app)/settings/password/actions";

export const dynamic = "force-dynamic";

export default async function ChangePasswordPage() {
  const user = await getCurrentAppUser();
  if (!user) redirect("/login");
  if (!canChangeOwnPassword(user.role)) redirect("/settings");

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          href="/settings"
          className="text-sm text-[var(--status-neutral)] underline-offset-2 hover:underline"
        >
          ← Settings
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground">
          Password
        </h1>
        <p className="mt-1 text-sm text-[var(--status-neutral)]">
          Change the password for {user.email}. You will stay signed in after updating.
        </p>
      </div>

      <ChangePasswordForm action={changeOwnPasswordAction} />
    </div>
  );
}
