import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentAppUser } from "@/lib/auth/session";
import { createClient } from "@/lib/database/supabase-server";
import { createProfilePhotoSignedUrl } from "@/lib/profilePhotos/storage";
import { ChangePasswordForm } from "@/components/forms/ChangePasswordForm";
import { ProfilePhotoForm } from "@/components/forms/ProfilePhotoForm";
import { SignOutButton } from "@/components/layout/SignOutButton";
import { changeOwnPasswordAction } from "@/app/(app)/settings/password/actions";
import {
  removeProfilePhotoAction,
  uploadProfilePhotoAction,
} from "@/app/account/actions";

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const user = await getCurrentAppUser();
  if (!user) redirect("/login");

  const supabase = await createClient();
  const photoUrl = await createProfilePhotoSignedUrl(supabase, user.profile_photo_path);

  return (
    <main className="min-h-full flex-1 bg-background">
      <header className="flex items-center justify-between gap-4 border-b border-chrome-border bg-chrome px-4 py-3 sm:px-6">
        <Link href={user.active_location_id ? "/" : "/account"}>
          <Image
            src="/otomoto-logo.png"
            alt="OTOMOTO Toronto Moto"
            width={150}
            height={52}
            className="h-9 w-auto"
            priority
          />
        </Link>
        <SignOutButton />
      </header>

      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-6 sm:px-6">
        {user.active_location_id ? (
          <Link
            href="/settings"
            className="w-fit text-sm text-[var(--status-neutral)] underline-offset-2 hover:underline"
          >
            ← Settings
          </Link>
        ) : (
          <p className="rounded border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">
            Your account does not have a shop location yet. You can still manage your
            photo and password here.
          </p>
        )}

        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            My account
          </h1>
          <p className="mt-1 text-sm text-[var(--status-neutral)]">
            Manage your profile photo and sign-in password for {user.email}.
          </p>
        </div>

        <div className="grid items-start gap-6 lg:grid-cols-2">
          <section className="space-y-3" aria-labelledby="profile-photo-heading">
            <div>
              <h2 id="profile-photo-heading" className="text-lg font-semibold">
                Profile photo
              </h2>
              <p className="text-sm text-[var(--status-neutral)]">
                Upload, replace, or remove your account photo.
              </p>
            </div>
            <ProfilePhotoForm
              firstName={user.first_name}
              lastName={user.last_name}
              photoUrl={photoUrl}
              uploadAction={uploadProfilePhotoAction}
              removeAction={removeProfilePhotoAction}
            />
          </section>

          <section className="space-y-3" aria-labelledby="password-heading">
            <div>
              <h2 id="password-heading" className="text-lg font-semibold">
                Password
              </h2>
              <p className="text-sm text-[var(--status-neutral)]">
                Confirm your current password before choosing a new one.
              </p>
            </div>
            <ChangePasswordForm action={changeOwnPasswordAction} />
          </section>
        </div>
      </div>
    </main>
  );
}
