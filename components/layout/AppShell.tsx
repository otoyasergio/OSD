import type { AppUser } from "@/lib/auth/session";
import { Nav } from "@/components/layout/Nav";
import {
  LocationSwitcher,
  type LocationOption,
} from "@/components/layout/LocationSwitcher";

const ROLE_LABELS: Record<AppUser["role"], string> = {
  owner: "Owner",
  manager: "Manager",
  service_advisor: "Service Advisor",
  technician: "Technician",
  admin: "Admin",
};

type Props = {
  user: AppUser;
  locations: LocationOption[];
  children: React.ReactNode;
};

export function AppShell({ user, locations, children }: Props) {
  const displayName = `${user.first_name} ${user.last_name}`.trim();

  return (
    <div className="flex min-h-full flex-1 flex-col bg-zinc-50">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-6">
            <p className="text-lg font-semibold tracking-tight text-zinc-900">
              OTOMOTO
            </p>
            <Nav />
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
            {user.active_location_id ? (
              <LocationSwitcher
                locations={locations}
                activeLocationId={user.active_location_id}
              />
            ) : null}
            <div className="text-sm text-zinc-600">
              <span className="font-medium text-zinc-900">{displayName}</span>
              <span className="mx-1.5 text-zinc-400">·</span>
              <span>{ROLE_LABELS[user.role]}</span>
            </div>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">{children}</main>
    </div>
  );
}
