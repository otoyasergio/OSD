import Link from "next/link";
import { redirect } from "next/navigation";
import { getRolePreviewContext } from "@/lib/auth/role-preview";
import {
  canManageContractTemplate,
  canManageInspectionTemplate,
  canManageLocations,
  canManageServiceCatalogue,
  canManageShopClosures,
  canManageTimesheets,
  canManageUsers,
  canViewAuditLog,
} from "@/lib/permissions";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const preview = await getRolePreviewContext();
  if (!preview) redirect("/login");
  const viewRole = preview.role;

  const links = [
    {
      href: "/account",
      label: "My account",
      description: "Manage your profile photo and password.",
      visible: true,
    },
    {
      href: "/settings/timesheets",
      label: "Timesheets",
      description: "Who is punched in, weekly hours, and punch corrections.",
      visible: canManageTimesheets(viewRole),
    },
    {
      href: "/settings/services",
      label: "Service catalogue",
      description: "Manage the services jobs are created from.",
      visible: canManageServiceCatalogue(viewRole),
    },
    {
      href: "/settings/inspection_template",
      label: "Inspection template",
      description: "Edit the checklist used for new inspections.",
      visible: canManageInspectionTemplate(viewRole),
    },
    {
      href: "/settings/contract_template",
      label: "Drop-off contract",
      description: "Edit the agreement customers sign at intake.",
      visible: canManageContractTemplate(viewRole),
    },
    {
      href: "/settings/closures",
      label: "Shop closures",
      description: "Set holidays and special closed dates used by intake.",
      visible: canManageShopClosures(viewRole),
    },
    {
      href: "/settings/locations",
      label: "Locations",
      description: "Create shops and assign staff to them.",
      visible: canManageLocations(viewRole),
    },
    {
      href: "/settings/users",
      label: "Users",
      description: "Manage staff accounts, roles, and status.",
      visible: canManageUsers(viewRole),
    },
    {
      href: "/settings/logs",
      label: "Logs",
      description: "Every action recorded across the company.",
      visible: canViewAuditLog(viewRole),
    },
  ].filter((link) => link.visible);

  return (
    <div className="page-stack">
      <PageHeader
        title="Settings"
        subtitle="Manage your account, catalogue, locations, users, and audit."
      />

      {links.length === 0 ? (
        <EmptyState description="You do not have access to any settings." />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {links.map((link) => (
            <li key={link.href}>
              <Link
                href={link.href}
                className="card block transition-shadow active:shadow-md"
              >
                <div className="card-body">
                  <span className="font-semibold text-foreground">{link.label}</span>
                  <span className="mt-1 block text-sm text-[var(--status-neutral)]">
                    {link.description}
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
