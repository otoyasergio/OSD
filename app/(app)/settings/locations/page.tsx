import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentAppUser } from "@/lib/auth/session";
import { canManageLocations } from "@/lib/permissions";
import {
  listLocations,
  listUsersForLocationAssignment,
} from "@/lib/services/locations";
import {
  LocationCreateForm,
  LocationEditForm,
} from "@/components/forms/LocationForms";
import {
  createLocationAction,
  setLocationUsersAction,
  updateLocationAction,
} from "@/app/(app)/settings/locations/actions";

export const dynamic = "force-dynamic";

export default async function LocationsAdminPage() {
  const user = await getCurrentAppUser();
  if (!user) redirect("/login");
  if (!canManageLocations(user.role)) redirect("/settings");

  const [locations, users] = await Promise.all([
    listLocations(),
    listUsersForLocationAssignment(),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          href="/settings"
          className="text-sm text-zinc-600 underline-offset-2 hover:underline"
        >
          ← Settings
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-900">
          Locations
        </h1>
        <p className="mt-1 text-sm text-zinc-600">
          Owner-only. Creating a location also starts its work order number
          sequence at WO-1001.
        </p>
      </div>

      <LocationCreateForm action={createLocationAction} />

      <div className="divide-y divide-zinc-100 rounded border border-zinc-200 bg-white">
        {locations.length === 0 ? (
          <p className="px-4 py-8 text-center text-zinc-600">
            No locations yet.
          </p>
        ) : (
          locations.map((location) => (
            <details key={location.location_id} className="px-4 py-3">
              <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-3">
                <span className="font-medium text-zinc-900">
                  {location.name}{" "}
                  <span className="text-zinc-500">({location.code})</span>
                  {location.status !== "active" ? (
                    <span className="ml-2 rounded bg-zinc-200 px-2 py-0.5 text-xs font-semibold text-zinc-700">
                      Inactive
                    </span>
                  ) : null}
                </span>
                <span className="text-sm text-zinc-600">
                  {location.user_count} staff
                </span>
              </summary>
              <LocationEditForm
                location={location}
                users={users}
                updateAction={updateLocationAction.bind(
                  null,
                  location.location_id
                )}
                assignAction={setLocationUsersAction.bind(
                  null,
                  location.location_id
                )}
              />
            </details>
          ))
        )}
      </div>
    </div>
  );
}
