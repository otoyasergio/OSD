import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentAppUser } from "@/lib/auth/session";
import { canUseMessenger } from "@/lib/permissions";
import { listDirectory, splitDirectorySections } from "@/lib/services/directory";
import { GroupComposer } from "@/components/messages/GroupComposer";
import { DirectoryList } from "@/components/messages/DirectoryList";
import { CallOverlay } from "@/components/messages/CallOverlay";

export const dynamic = "force-dynamic";

export default async function NewMessagePage() {
  const user = await getCurrentAppUser();
  if (!user) redirect("/login");
  if (!canUseMessenger(user.role)) redirect("/dashboard");

  const staff = await listDirectory();
  const { atLocation, allCompany } = splitDirectorySections(
    staff,
    user.active_location_id
  );

  return (
    <div className="page-stack mx-auto max-w-2xl">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">New message</h1>
          <p className="mt-1 text-sm text-slate-500">
            Start a direct message or create a group.
          </p>
        </div>
        <Link href="/messages" className="btn">
          Back
        </Link>
      </div>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Direct message
        </h2>
        <DirectoryList atLocation={atLocation} allCompany={allCompany} />
      </section>

      <section className="border-t border-[var(--border)] pt-6">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
          New group
        </h2>
        <GroupComposer atLocation={atLocation} allCompany={allCompany} />
      </section>

      <CallOverlay currentUserId={user.user_id} />
    </div>
  );
}
