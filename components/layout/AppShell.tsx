"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import type { AppUser } from "@/lib/auth/session";
import { GlobalSearch } from "@/components/layout/GlobalSearch";
import { SidebarNav } from "@/components/layout/SidebarNav";
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

function isInspectionFullscreenPath(pathname: string) {
  return /\/work_orders\/[^/]+\/inspection\/?$/.test(pathname);
}

export function AppShell({ user, locations, children }: Props) {
  const pathname = usePathname();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const hideChrome = isInspectionFullscreenPath(pathname);
  const displayName = `${user.first_name} ${user.last_name}`.trim();

  useEffect(() => {
    // Close drawer when navigating (e.g. back button) without leaving it open over new page.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional route-change reset
    setMobileNavOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!mobileNavOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [mobileNavOpen]);

  if (hideChrome) {
    return (
      <div className="flex min-h-full flex-1 flex-col bg-background">
        <main className="inspection-fullscreen-main">{children}</main>
      </div>
    );
  }

  return (
    <div
      className={`app-shell bg-background${mobileNavOpen ? " app-shell-nav-open" : ""}`}
    >
      <header className="mobile-header">
        <Link
          href="/dashboard"
          className="mobile-header-brand"
          aria-label="OTOMOTO Toronto Moto home"
        >
          <Image
            src="/otomoto-logo.png"
            alt="OTOMOTO Toronto Moto"
            width={150}
            height={52}
            className="h-8 w-auto"
            priority
          />
        </Link>
        <button
          type="button"
          className="mobile-menu-button"
          aria-expanded={mobileNavOpen}
          aria-controls="app-sidebar-nav"
          onClick={() => setMobileNavOpen((open) => !open)}
        >
          {mobileNavOpen ? "Close menu" : "Open menu"}
        </button>
      </header>

      <button
        type="button"
        className="sidebar-backdrop"
        aria-label="Close navigation menu"
        tabIndex={mobileNavOpen ? 0 : -1}
        onClick={() => setMobileNavOpen(false)}
      />

      <aside id="app-sidebar-nav" className="sidebar">
        <Link
          href="/dashboard"
          className="sidebar-brand sidebar-brand-desktop"
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
        <SidebarNav onNavigate={() => setMobileNavOpen(false)} />
      </aside>

      <div className="main-content">
        <header className="main-topbar">
          <GlobalSearch />
          <div className="main-topbar-actions">
            {user.active_location_id ? (
              <LocationSwitcher
                locations={locations}
                activeLocationId={user.active_location_id}
              />
            ) : null}
            <div className="main-topbar-user rounded-md border border-chrome-border bg-chrome-elevated px-3 py-1.5 text-sm text-chrome-muted">
              <span className="font-semibold text-chrome-foreground">
                {displayName}
              </span>
              <span className="mx-1.5 opacity-40">·</span>
              <span>{ROLE_LABELS[user.role]}</span>
            </div>
          </div>
        </header>
        <main className="main-body">{children}</main>
      </div>
    </div>
  );
}
