"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import type { AppUser } from "@/lib/auth/session";
import { isFloorTech, staffHomePath } from "@/lib/permissions/checks";
import { GlobalSearch } from "@/components/layout/GlobalSearch";
import { SidebarNav } from "@/components/layout/SidebarNav";
import {
  LocationSwitcher,
  type LocationOption,
} from "@/components/layout/LocationSwitcher";
import { SignOutButton } from "@/components/layout/SignOutButton";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { StaffNotificationBell } from "@/components/layout/StaffNotificationBell";
import {
  markAllStaffNotificationsReadAction,
  markStaffNotificationReadAction,
  refreshStaffNotificationsAction,
} from "@/app/(app)/notifications/actions";
import type { StaffAssignmentNotification } from "@/lib/services/staffNotifications";
import { staffAssignmentHref } from "@/lib/technician/assignmentHref";

const ROLE_LABELS: Record<AppUser["role"], string> = {
  owner: "Owner",
  manager: "Manager",
  service_advisor: "Service Advisor",
  technician: "Technician",
  head_tech: "Head Tech",
  admin: "Admin",
  time_clock_kiosk: "Time Clock Kiosk",
};

type Props = {
  user: AppUser;
  locations: LocationOption[];
  profilePhotoUrl: string | null;
  initialNotifications: StaffAssignmentNotification[];
  children: React.ReactNode;
};

function isInspectionFullscreenPath(pathname: string) {
  return /\/work_orders\/[^/]+\/inspection\/?$/.test(pathname);
}

export function AppShell({
  user,
  locations,
  profilePhotoUrl,
  initialNotifications,
  children,
}: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [notificationOpen, setNotificationOpen] = useState(false);
  const [notifications, setNotifications] = useState(initialNotifications);
  const [notificationBusy, setNotificationBusy] = useState(false);
  const [notificationError, setNotificationError] = useState<string | null>(null);
  const [incomingNotification, setIncomingNotification] =
    useState<StaffAssignmentNotification | null>(null);
  const knownNotificationIds = useRef(
    new Set(initialNotifications.map((notification) => notification.notification_id))
  );
  const hideChrome = isInspectionFullscreenPath(pathname);
  const displayName = `${user.first_name} ${user.last_name}`.trim();
  const homeHref = staffHomePath(user.role);
  const notificationsEnabled = isFloorTech(user.role);

  const refreshNotifications = useCallback(async () => {
    try {
      const next = await refreshStaffNotificationsAction();
      const incoming = next.find(
        (notification) => !knownNotificationIds.current.has(notification.notification_id)
      );
      for (const notification of next) {
        knownNotificationIds.current.add(notification.notification_id);
      }
      setNotifications(next);
      setNotificationError(null);
      if (incoming) setIncomingNotification(incoming);
    } catch {
      setNotificationError("Could not refresh alerts. We will keep trying.");
    }
  }, []);

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

  useEffect(() => {
    if (!notificationsEnabled) return;

    const poll = () => {
      void refreshNotifications();
    };
    const timer = window.setInterval(poll, 5_000);
    window.addEventListener("focus", poll);
    document.addEventListener("visibilitychange", poll);

    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", poll);
      document.removeEventListener("visibilitychange", poll);
    };
  }, [notificationsEnabled, refreshNotifications]);

  async function openNotification(notification: StaffAssignmentNotification) {
    setNotificationBusy(true);
    setNotificationError(null);
    try {
      await markStaffNotificationReadAction(notification.notification_id);
      setNotifications((current) =>
        current.filter((item) => item.notification_id !== notification.notification_id)
      );
      setIncomingNotification((current) =>
        current?.notification_id === notification.notification_id ? null : current
      );
      setNotificationOpen(false);
      router.push(staffAssignmentHref(notification.work_order_id));
    } catch {
      setNotificationError("Could not mark this alert as seen. Try again.");
      setNotificationOpen(true);
    } finally {
      setNotificationBusy(false);
    }
  }

  async function markAllNotificationsRead() {
    setNotificationBusy(true);
    setNotificationError(null);
    try {
      await markAllStaffNotificationsReadAction();
      setNotifications([]);
      setIncomingNotification(null);
    } catch {
      setNotificationError("Could not mark alerts as seen. Try again.");
    } finally {
      setNotificationBusy(false);
    }
  }

  const notificationBell = (
    <StaffNotificationBell
      notifications={notifications}
      open={notificationOpen}
      busy={notificationBusy}
      error={notificationError}
      onToggle={() => setNotificationOpen((current) => !current)}
      onOpenNotification={(notification) => void openNotification(notification)}
      onMarkAllRead={() => void markAllNotificationsRead()}
    />
  );

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
      <a href="#main-content" className="skip-link">
        Skip to main content
      </a>
      <header className="mobile-header">
        <Link
          href={homeHref}
          className="mobile-header-brand"
          aria-label="OTOMOTO Toronto Moto home"
        >
          <Image
            src="/otomoto-logo.png"
            alt="OTOMOTO Toronto Moto"
            width={240}
            height={84}
            className="brand-logo brand-logo--mobile"
            priority
          />
        </Link>
        <div className="flex items-center gap-2">
          {notificationsEnabled ? notificationBell : null}
          <Link href="/account" aria-label="Open my account">
            <UserAvatar
              firstName={user.first_name}
              lastName={user.last_name}
              photoUrl={profilePhotoUrl}
              size="sm"
              className="ring-1 ring-chrome-border"
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
        </div>
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
          href={homeHref}
          className="sidebar-brand sidebar-brand-desktop"
          aria-label="OTOMOTO Toronto Moto home"
        >
          <Image
            src="/otomoto-logo.png"
            alt="OTOMOTO Toronto Moto"
            width={260}
            height={90}
            className="brand-logo"
            priority
          />
          <span className="brand-wordmark" aria-hidden>
            OTOMOTO
          </span>
        </Link>
        <SidebarNav role={user.role} onNavigate={() => setMobileNavOpen(false)} />
      </aside>

      <div className="main-content">
        <header className="main-topbar">
          <GlobalSearch />
          <div className="main-topbar-actions">
            {notificationsEnabled ? notificationBell : null}
            {user.active_location_id ? (
              <LocationSwitcher
                locations={locations}
                activeLocationId={user.active_location_id}
              />
            ) : null}
            <Link
              href="/account"
              className="main-topbar-user flex items-center gap-2 rounded-md border border-chrome-border bg-chrome-elevated px-2 py-1.5 text-sm text-chrome-muted hover:border-slate-600"
              aria-label="Open my account"
            >
              <UserAvatar
                firstName={user.first_name}
                lastName={user.last_name}
                photoUrl={profilePhotoUrl}
                size="sm"
              />
              <span>
                <span className="font-semibold text-chrome-foreground">
                  {displayName}
                </span>
                <span className="mx-1.5 opacity-40">·</span>
                <span>{ROLE_LABELS[user.role]}</span>
              </span>
            </Link>
            <SignOutButton />
          </div>
        </header>
        <main id="main-content" className="main-body" tabIndex={-1}>
          {children}
        </main>
      </div>

      {incomingNotification ? (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-4 right-4 z-[70] w-[min(24rem,calc(100vw-2rem))] rounded-xl border border-blue-200 bg-white p-4 text-slate-900 shadow-2xl"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-semibold">New motorcycle assignment</p>
              <p className="mt-1 text-sm text-slate-700">
                {incomingNotification.work_order_number} ·{" "}
                {incomingNotification.motorcycle_label}
              </p>
            </div>
            <button
              type="button"
              className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
              aria-label="Dismiss alert"
              onClick={() => setIncomingNotification(null)}
            >
              <X size={18} aria-hidden />
            </button>
          </div>
          <button
            type="button"
            className="btn btn-primary mt-3 w-full"
            disabled={notificationBusy}
            onClick={() => void openNotification(incomingNotification)}
          >
            Open assigned motorcycle
          </button>
        </div>
      ) : null}
    </div>
  );
}
