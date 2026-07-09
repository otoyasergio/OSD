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
    <div>
      <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">
        Settings
      </h1>

      {links.length === 0 ? (
        <p className="mt-8 rounded border border-dashed border-zinc-300 bg-white px-4 py-10 text-center text-zinc-600">
          You do not have access to any settings.
        </p>
      ) : (
        <ul className="mt-4 grid gap-3 sm:grid-cols-2">
          {links.map((link) => (
            <li key={link.href}>
              <Link
                href={link.href}
                className="block rounded border border-zinc-200 bg-white p-4 hover:border-zinc-400"
              >
                <span className="font-medium text-zinc-900">{link.label}</span>
                <span className="mt-1 block text-sm text-zinc-600">
                  {link.description}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
