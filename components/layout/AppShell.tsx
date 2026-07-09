import Image from "next/image";
import Link from "next/link";
import type { AppUser } from "@/lib/auth/session";
import { GlobalSearch } from "@/components/layout/GlobalSearch";
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
    <div className="flex min-h-full flex-1 flex-col bg-background">
      <header className="border-b border-chrome-border bg-chrome">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-5">
            <Link
              href="/dashboard"
              className="inline-flex shrink-0 items-center"
              aria-label="OTOMOTO Toronto Moto home"
            >
              <Image
                src="/otomoto-logo.png"
                alt="OTOMOTO Toronto Moto"
                width={150}
                height={52}
                className="h-9 w-auto"
                priority
              />
            </Link>
            <Nav />
            <GlobalSearch />
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
            {user.active_location_id ? (
              <LocationSwitcher
                locations={locations}
                activeLocationId={user.active_location_id}
              />
            ) : null}
            <div className="rounded-md border border-chrome-border bg-chrome-elevated px-3 py-1.5 text-sm text-chrome-muted">
              <span className="font-semibold text-chrome-foreground">{displayName}</span>
              <span className="mx-1.5 opacity-40">·</span>
              <span>{ROLE_LABELS[user.role]}</span>
            </div>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">{children}</main>
    </div>
  );
}
