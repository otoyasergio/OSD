import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentAppUser } from "@/lib/auth/session";
import { canUseMessenger } from "@/lib/permissions";
import { listDirectory, splitDirectorySections } from "@/lib/services/directory";
import { DirectoryList } from "@/components/messages/DirectoryList";
import { CallOverlay } from "@/components/messages/CallOverlay";

export const dynamic = "force-dynamic";

type Props = {
  searchParams: Promise<{ q?: string }>;
};

export default async function DirectoryPage({ searchParams }: Props) {
  const user = await getCurrentAppUser();
  if (!user) redirect("/login");
  if (!canUseMessenger(user.role)) redirect("/dashboard");

  const { q } = await searchParams;
  const staff = await listDirectory(q);
  const { atLocation, allCompany } = splitDirectorySections(
    staff,
    user.active_location_id
  );

  return (
    <div className="page-stack mx-auto max-w-2xl">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Directory</h1>
          <p className="mt-1 text-sm text-slate-500">
            People at your location first, then the rest of the company.
          </p>
        </div>
        <Link href="/messages" className="btn">
          Back
        </Link>
      </div>
      <form className="flex gap-2">
        <input
          className="input flex-1"
          name="q"
          defaultValue={q ?? ""}
          placeholder="Search by name"
        />
        <button type="submit" className="btn btn-primary">
          Search
        </button>
      </form>
      <DirectoryList atLocation={atLocation} allCompany={allCompany} />
      <CallOverlay currentUserId={user.user_id} />
    </div>
  );
}
