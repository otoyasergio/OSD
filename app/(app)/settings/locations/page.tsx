import Link from "next/link";
import { redirect } from "next/navigation";
import { getRolePreviewContext } from "@/lib/auth/role-preview";
import { canManageLocations } from "@/lib/permissions";
import { listLocations, listUsersForLocationAssignment } from "@/lib/services/locations";
import { LocationCreateForm, LocationEditForm } from "@/components/forms/LocationForms";
import {
  createLocationAction,
  setLocationUsersAction,
  updateLocationAction,
} from "@/app/(app)/settings/locations/actions";

export const dynamic = "force-dynamic";

export default async function LocationsAdminPage() {
  const preview = await getRolePreviewContext();
  if (!preview) redirect("/login");
  if (!canManageLocations(preview.role)) redirect("/settings");

  const [locations, users] = await Promise.all([
    listLocations(),
    listUsersForLocationAssignment(),
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
          Locations
        </h1>
        <p className="mt-1 text-sm text-[var(--status-neutral)]">
          Owner-only. Creating a location also starts its work order number sequence at
          WO-1001.
        </p>
      </div>

      <LocationCreateForm action={createLocationAction} />

      <div className="divide-y divide-[var(--border)] rounded border border-[var(--border)] bg-white">
        {locations.length === 0 ? (
          <p className="px-4 py-8 text-center text-[var(--status-neutral)]">
            No locations yet.
          </p>
        ) : (
          locations.map((location) => (
            <details key={location.location_id} className="px-4 py-3">
              <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-3">
                <span className="font-medium text-foreground">
                  {location.name}{" "}
                  <span className="text-[var(--status-neutral)]">({location.code})</span>
                  {location.status !== "active" ? (
                    <span className="ml-2 rounded bg-[var(--border)] px-2 py-0.5 text-xs font-semibold text-foreground">
                      Inactive
                    </span>
                  ) : null}
                </span>
                <span className="text-sm text-[var(--status-neutral)]">
                  {location.user_count} staff
                </span>
              </summary>
              <LocationEditForm
                location={location}
                users={users}
                updateAction={updateLocationAction.bind(null, location.location_id)}
                assignAction={setLocationUsersAction.bind(null, location.location_id)}
              />
            </details>
          ))
        )}
      </div>
    </div>
  );
}
