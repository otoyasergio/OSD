"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { UserRole } from "@/lib/database/types";
import { canViewBillingArea } from "@/lib/permissions/checks";

type NavLink = { href: string; label: string };

function buildPrimaryLinks(role: UserRole): NavLink[] {
  const links: NavLink[] = [
    { href: "/dashboard", label: "Dashboard" },
    { href: "/work_orders", label: "Work Orders" },
    { href: "/complete", label: "Complete and filed" },
    { href: "/parts", label: "Parts" },
  ];
  if (canViewBillingArea(role)) {
    links.push({ href: "/billing", label: "Billing" });
  }
  links.push(
    { href: "/customers", label: "Customers" },
    { href: "/motorcycles", label: "Motorcycles" },
    { href: "/technician", label: "Technician" }
  );
  return links;
}

const SETTINGS_LINK = { href: "/settings", label: "Settings" } as const;

function isActivePath(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

type Props = {
  role: UserRole;
  onNavigate?: () => void;
};

export function SidebarNav({ role, onNavigate }: Props) {
  const pathname = usePathname();
  const primaryLinks = buildPrimaryLinks(role);

  return (
    <nav aria-label="Main" className="sidebar-nav">
      <div className="sidebar-nav-primary">
        {primaryLinks.map((link) => {
          const active = isActivePath(pathname, link.href);
          return (
            <Link
              key={link.href}
              href={link.href}
              className={active ? "nav-link nav-link-active" : "nav-link"}
              aria-current={active ? "page" : undefined}
              onClick={onNavigate}
            >
              {link.label}
            </Link>
          );
        })}
      </div>
      <div className="sidebar-nav-section">
        <p className="sidebar-nav-section-label">Settings</p>
        <Link
          href={SETTINGS_LINK.href}
          className={
            isActivePath(pathname, SETTINGS_LINK.href)
              ? "nav-link nav-link-active"
              : "nav-link"
          }
          aria-current={
            isActivePath(pathname, SETTINGS_LINK.href) ? "page" : undefined
          }
          onClick={onNavigate}
        >
          {SETTINGS_LINK.label}
        </Link>
      </div>
    </nav>
  );
}
