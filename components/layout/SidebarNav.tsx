"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { UserRole } from "@/lib/database/types";
import {
  canManageContractTemplate,
  canManageInspectionTemplate,
  canManageLocations,
  canManageServiceCatalogue,
  canManageTimesheets,
  canManageUsers,
  canViewAuditLog,
  canViewBillingArea,
  canViewPartsBoard,
  canViewReports,
} from "@/lib/permissions/checks";

type NavLink = { href: string; label: string };

type NavSubgroup = {
  heading?: string;
  links: NavLink[];
};

type NavCategory = {
  id: string;
  label: string;
  subgroups: NavSubgroup[];
};

export function buildNavCategories(role: UserRole): NavCategory[] {
  const financesLinks: NavLink[] = [];
  if (canViewBillingArea(role)) {
    financesLinks.push({ href: "/billing", label: "Billing" });
  }
  financesLinks.push({ href: "/complete", label: "Complete and filed" });

  const shopFloorLinks: NavLink[] = [
    { href: "/dashboard", label: "Dashboard" },
    { href: "/work_orders", label: "Work Orders" },
  ];
  if (canViewPartsBoard(role)) {
    shopFloorLinks.push({ href: "/parts", label: "Parts" });
  }

  const staffingLinks: NavLink[] = [{ href: "/technician", label: "Technician" }];
  if (canManageTimesheets(role)) {
    staffingLinks.push({ href: "/settings/timesheets", label: "Timesheets" });
  }

  const shopSettings: NavLink[] = [];
  if (canManageLocations(role)) {
    shopSettings.push({ href: "/settings/locations", label: "Locations" });
  }
  if (canManageInspectionTemplate(role)) {
    shopSettings.push({
      href: "/settings/inspection_template",
      label: "Inspection template",
    });
  }
  if (canManageContractTemplate(role)) {
    shopSettings.push({
      href: "/settings/contract_template",
      label: "Drop-off contract",
    });
  }

  const catalogueSettings: NavLink[] = [];
  if (canManageServiceCatalogue(role)) {
    catalogueSettings.push({
      href: "/settings/services",
      label: "Service catalogue",
    });
  }

  const adminSettings: NavLink[] = [];
  if (canManageUsers(role)) {
    adminSettings.push({ href: "/settings/users", label: "Users" });
  }
  if (canViewAuditLog(role)) {
    adminSettings.push({ href: "/settings/audit", label: "Audit log" });
  }
  if (canViewReports(role)) {
    adminSettings.push({ href: "/settings/reports", label: "Reports" });
  }

  const settingsSubgroups: NavSubgroup[] = [
    { links: [{ href: "/settings", label: "Settings" }] },
  ];
  if (shopSettings.length > 0) {
    settingsSubgroups.push({ heading: "Shop", links: shopSettings });
  }
  if (catalogueSettings.length > 0) {
    settingsSubgroups.push({ heading: "Catalogue", links: catalogueSettings });
  }
  if (adminSettings.length > 0) {
    settingsSubgroups.push({ heading: "Admin", links: adminSettings });
  }

  const categories: NavCategory[] = [
    {
      id: "finances",
      label: "Finances",
      subgroups: [{ links: financesLinks }],
    },
    {
      id: "clients",
      label: "Clients",
      subgroups: [
        { heading: "Shop floor", links: shopFloorLinks },
        {
          heading: "Records",
          links: [
            { href: "/customers", label: "Customers" },
            { href: "/motorcycles", label: "Motorcycles" },
          ],
        },
      ],
    },
    {
      id: "communication",
      label: "Communication",
      // No standalone communications page yet — keep slot for when one ships.
      subgroups: [],
    },
    {
      id: "staffing",
      label: "Staffing",
      subgroups: [{ links: staffingLinks }],
    },
    {
      id: "settings",
      label: "Settings",
      subgroups: settingsSubgroups,
    },
  ];

  return categories.filter((category) =>
    category.subgroups.some((group) => group.links.length > 0)
  );
}

function isActivePath(pathname: string, href: string) {
  if (href === "/settings") {
    return pathname === "/settings";
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

type Props = {
  role: UserRole;
  onNavigate?: () => void;
};

export function SidebarNav({ role, onNavigate }: Props) {
  const pathname = usePathname();
  const categories = buildNavCategories(role);

  return (
    <nav aria-label="Main" className="sidebar-nav">
      {categories.map((category) => (
        <div key={category.id} className="sidebar-nav-category">
          <p className="sidebar-nav-category-label">{category.label}</p>
          {category.subgroups.map((group, index) => (
            <div
              key={group.heading ?? `${category.id}-${index}`}
              className="sidebar-nav-subgroup"
            >
              {group.heading ? (
                <p className="sidebar-nav-subheading">{group.heading}</p>
              ) : null}
              {group.links.map((link) => {
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
          ))}
        </div>
      ))}
    </nav>
  );
}
