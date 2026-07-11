"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const PRIMARY_LINKS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/work_orders", label: "Work Orders" },
  { href: "/complete", label: "Complete and filed" },
  { href: "/parts", label: "Parts" },
  { href: "/customers", label: "Customers" },
  { href: "/motorcycles", label: "Motorcycles" },
  { href: "/technician", label: "Technician" },
] as const;

const SETTINGS_LINK = { href: "/settings", label: "Settings" } as const;

function isActivePath(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function SidebarNav() {
  const pathname = usePathname();

  return (
    <nav aria-label="Main" className="sidebar-nav">
      <div className="sidebar-nav-primary">
        {PRIMARY_LINKS.map((link) => {
          const active = isActivePath(pathname, link.href);
          return (
            <Link
              key={link.href}
              href={link.href}
              className={active ? "nav-link nav-link-active" : "nav-link"}
              aria-current={active ? "page" : undefined}
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
        >
          {SETTINGS_LINK.label}
        </Link>
      </div>
    </nav>
  );
}
