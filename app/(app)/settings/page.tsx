import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentAppUser } from "@/lib/auth/session";
import {
  canManageInspectionTemplate,
  canManageLocations,
  canManageServiceCatalogue,
  canManageUsers,
  canViewAuditLog,
} from "@/lib/permissions";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await getCurrentAppUser();
  if (!user) redirect("/login");

  const links = [
    {
      href: "/settings/services",
      label: "Service catalogue",
      description: "Manage the services jobs are created from.",
      visible: canManageServiceCatalogue(user.role),
    },
    {
      href: "/settings/inspection_template",
      label: "Inspection template",
      description: "Edit the checklist used for new inspections.",
      visible: canManageInspectionTemplate(user.role),
    },
    {
      href: "/settings/locations",
      label: "Locations",
      description: "Create shops and assign staff to them.",
      visible: canManageLocations(user.role),
    },
    {
      href: "/settings/users",
      label: "Users",
      description: "Manage staff accounts, roles, and status.",
      visible: canManageUsers(user.role),
    },
    {
      href: "/settings/audit",
      label: "Audit log",
      description: "Every action recorded across the company.",
      visible: canViewAuditLog(user.role),
    },
  ].filter((link) => link.visible);

  return (
    <div className="page-stack">
      <PageHeader
        title="Settings"
        subtitle="Configure catalogue, locations, users, and audit."
      />

      {links.length === 0 ? (
        <EmptyState description="You do not have access to any settings." />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {links.map((link) => (
            <li key={link.href}>
              <Link href={link.href} className="card block transition-shadow active:shadow-md">
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
