import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentAppUser } from "@/lib/auth/session";
import { canManageUsers } from "@/lib/permissions";
import { listLocationOptions, listManagedUsers } from "@/lib/services/users";
import { UserEditForm, UserLinkForm } from "@/components/forms/UserForms";
import {
  linkAppUserAction,
  setAppUserStatusAction,
  updateAppUserAction,
} from "@/app/(app)/settings/users/actions";

export const dynamic = "force-dynamic";

export default async function UsersAdminPage() {
  const user = await getCurrentAppUser();
  if (!user) redirect("/login");
  if (!canManageUsers(user.role)) redirect("/settings");

  const [users, locations] = await Promise.all([
    listManagedUsers(),
    listLocationOptions(),
  ]);

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
          Users
        </h1>
        <p className="mt-1 text-sm text-[var(--status-neutral)]">
          Owner-only. Suspended or inactive users cannot sign in (
          <code className="text-xs">getCurrentAppUser</code> requires{" "}
          <code className="text-xs">status = active</code>).
        </p>
      </div>

      <UserLinkForm action={linkAppUserAction} locations={locations} />

      <div className="divide-y divide-[var(--border)] rounded border border-[var(--border)] bg-white">
        {users.length === 0 ? (
          <p className="px-4 py-8 text-center text-[var(--status-neutral)]">
            No users yet.
          </p>
        ) : (
          users.map((person) => (
            <details key={person.user_id} className="px-4 py-3">
              <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-3">
                <span className="font-medium text-foreground">
                  {person.first_name} {person.last_name}{" "}
                  <span className="text-[var(--status-neutral)]">· {person.role}</span>
                  {person.status !== "active" ? (
                    <span className="ml-2 rounded bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-900">
                      {person.status}
                    </span>
                  ) : null}
                </span>
                <span className="text-sm text-[var(--status-neutral)]">
                  {person.locations.map((loc) => loc.code).join(", ") || "No locations"}
                </span>
              </summary>
              <UserEditForm
                user={person}
                locations={locations}
                updateAction={updateAppUserAction.bind(null, person.user_id)}
                suspendAction={setAppUserStatusAction.bind(
                  null,
                  person.user_id,
                  "suspended"
                )}
                activateAction={setAppUserStatusAction.bind(
                  null,
                  person.user_id,
                  "active"
                )}
              />
            </details>
          ))
        )}
      </div>
    </div>
  );
}
