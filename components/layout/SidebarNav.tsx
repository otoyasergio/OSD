"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import {
  LayoutDashboard,
  ClipboardList,
  Package,
  Wrench,
  Clock3,
  Users,
  Bike,
  Settings,
  MapPin,
  FileCheck,
  ScrollText,
  BookOpen,
  Shield,
  BarChart3,
  Wallet,
  Archive,
  MessageSquare,
  ListOrdered,
  Gauge,
} from "lucide-react";
import type { UserRole } from "@/lib/database/types";
import {
  canAssignTechnician,
  canManageContractTemplate,
  canManageInspectionTemplate,
  canManageLocations,
  canManageServiceCatalogue,
  canManageTimesheets,
  canManageUsers,
  canSelfClock,
  canUseMessenger,
  canViewAuditLog,
  canViewBillingArea,
  canViewClients,
  canViewDashboard,
  canViewFiledArchive,
  canViewPartsBoard,
  canViewReports,
  isFloorTech,
} from "@/lib/permissions/checks";

type NavLink = { href: string; label: string; icon: LucideIcon };

const NAV_ICONS: Record<string, LucideIcon> = {
  "/control-center": Gauge,
  "/dashboard": LayoutDashboard,
  "/work_orders": ClipboardList,
  "/parts": Package,
  "/technician": Wrench,
  "/technician/clock": Clock3,
  "/technician/docket": ListOrdered,
  "/settings/timesheets": Clock3,
  "/customers": Users,
  "/motorcycles": Bike,
  "/settings": Settings,
  "/settings/locations": MapPin,
  "/settings/inspection_template": FileCheck,
  "/settings/contract_template": ScrollText,
  "/settings/services": BookOpen,
  "/settings/users": Shield,
  "/settings/logs": ScrollText,
  "/settings/audit": ScrollText,
  "/settings/reports": BarChart3,
  "/billing": Wallet,
  "/complete": Archive,
  "/messages": MessageSquare,
};

function iconFor(href: string): LucideIcon {
  return NAV_ICONS[href] ?? ClipboardList;
}

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
    financesLinks.push({
      href: "/billing",
      label: "Billing",
      icon: iconFor("/billing"),
    });
  }
  if (canViewFiledArchive(role)) {
    financesLinks.push({
      href: "/complete",
      label: "Complete and filed",
      icon: iconFor("/complete"),
    });
  }

  const shopFloorLinks: NavLink[] = [];
  if (canViewDashboard(role)) {
    shopFloorLinks.push({
      href: "/control-center",
      label: "Control Center",
      icon: iconFor("/control-center"),
    });
    shopFloorLinks.push({
      href: "/dashboard",
      label: "Dashboard",
      icon: iconFor("/dashboard"),
    });
  }
  if (!isFloorTech(role)) {
    shopFloorLinks.push({
      href: "/work_orders",
      label: "Work Orders",
      icon: iconFor("/work_orders"),
    });
  }
  if (canViewPartsBoard(role)) {
    shopFloorLinks.push({
      href: "/parts",
      label: "Parts",
      icon: iconFor("/parts"),
    });
  }

  const staffingLinks: NavLink[] = [
    { href: "/technician", label: "Technician", icon: iconFor("/technician") },
  ];
  if (canSelfClock(role)) {
    staffingLinks.push({
      href: "/technician/clock",
      label: "Time clock",
      icon: iconFor("/technician/clock"),
    });
  }
  if (canAssignTechnician(role)) {
    staffingLinks.push({
      href: "/technician/docket",
      label: "Docket",
      icon: iconFor("/technician/docket"),
    });
  }
  if (canManageTimesheets(role)) {
    staffingLinks.push({
      href: "/settings/timesheets",
      label: "Timesheets",
      icon: iconFor("/settings/timesheets"),
    });
  }

  const shopSettings: NavLink[] = [];
  if (canManageLocations(role)) {
    shopSettings.push({
      href: "/settings/locations",
      label: "Locations",
      icon: iconFor("/settings/locations"),
    });
  }
  if (canManageInspectionTemplate(role)) {
    shopSettings.push({
      href: "/settings/inspection_template",
      label: "Inspection template",
      icon: iconFor("/settings/inspection_template"),
    });
  }
  if (canManageContractTemplate(role)) {
    shopSettings.push({
      href: "/settings/contract_template",
      label: "Drop-off contract",
      icon: iconFor("/settings/contract_template"),
    });
  }

  const catalogueSettings: NavLink[] = [];
  if (canManageServiceCatalogue(role)) {
    catalogueSettings.push({
      href: "/settings/services",
      label: "Service catalogue",
      icon: iconFor("/settings/services"),
    });
  }

  const adminSettings: NavLink[] = [];
  if (canManageUsers(role)) {
    adminSettings.push({
      href: "/settings/users",
      label: "Users",
      icon: iconFor("/settings/users"),
    });
  }
  if (canViewAuditLog(role)) {
    adminSettings.push({
      href: "/settings/logs",
      label: "Logs",
      icon: iconFor("/settings/logs"),
    });
  }
  if (canViewReports(role)) {
    adminSettings.push({
      href: "/settings/reports",
      label: "Reports",
      icon: iconFor("/settings/reports"),
    });
  }

  const settingsSubgroups: NavSubgroup[] = [
    {
      links: [{ href: "/settings", label: "Settings", icon: iconFor("/settings") }],
    },
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

  const communicationLinks: NavLink[] = [];
  if (canUseMessenger(role)) {
    communicationLinks.push({
      href: "/messages",
      label: "Messages",
      icon: iconFor("/messages"),
    });
  }

  const clientSubgroups: NavSubgroup[] = [
    { heading: "Shop floor", links: shopFloorLinks },
  ];
  if (canViewClients(role)) {
    clientSubgroups.push({
      heading: "Records",
      links: [
        {
          href: "/customers",
          label: "Customers",
          icon: iconFor("/customers"),
        },
        {
          href: "/motorcycles",
          label: "Motorcycles",
          icon: iconFor("/motorcycles"),
        },
      ],
    });
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
      subgroups: clientSubgroups,
    },
    {
      id: "communication",
      label: "Communication",
      subgroups: communicationLinks.length > 0 ? [{ links: communicationLinks }] : [],
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
                const Icon = link.icon;
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    className={active ? "nav-link nav-link-active" : "nav-link"}
                    aria-current={active ? "page" : undefined}
                    onClick={onNavigate}
                  >
                    <Icon className="nav-link-icon" aria-hidden />
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
