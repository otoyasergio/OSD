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
import { GroupedList } from "@/components/ui/GroupedList";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const preview = await getRolePreviewContext();
  if (!preview) redirect("/login");
  const viewRole = preview.role;

  const account = [
    {
      href: "/account",
      label: "My account",
      description: "Profile photo and password.",
    },
  ];

  const shop = [
    {
      href: "/settings/timesheets",
      label: "Timesheets",
      description: "Who is punched in, weekly hours, and punch corrections.",
      visible: canManageTimesheets(viewRole),
    },
    {
      href: "/settings/services",
      label: "Service catalogue",
      description: "Services jobs are created from.",
      visible: canManageServiceCatalogue(viewRole),
    },
    {
      href: "/settings/inspection_template",
      label: "Inspection template",
      description: "Checklist used for new inspections.",
      visible: canManageInspectionTemplate(viewRole),
    },
    {
      href: "/settings/contract_template",
      label: "Drop-off contract",
      description: "Agreement customers sign at intake.",
      visible: canManageContractTemplate(viewRole),
    },
    {
      href: "/settings/closures",
      label: "Shop closures",
      description: "Holidays and special closed dates.",
      visible: canManageShopClosures(viewRole),
    },
    {
      href: "/settings/locations",
      label: "Locations",
      description: "Shops and staff assignments.",
      visible: canManageLocations(viewRole),
    },
  ]
    .filter((link) => link.visible)
    .map(({ visible: _visible, ...link }) => link);

  const admin = [
    {
      href: "/settings/users",
      label: "Users",
      description: "Staff accounts, roles, and status.",
      visible: canManageUsers(viewRole),
    },
    {
      href: "/settings/logs",
      label: "Logs",
      description: "Every action recorded across the company.",
      visible: canViewAuditLog(viewRole),
    },
  ]
    .filter((link) => link.visible)
    .map(({ visible: _visible, ...link }) => link);

  const hasAny = account.length + shop.length + admin.length > 0;

  return (
    <div className="page-stack page-stack--narrow">
      <PageHeader
        title="Settings"
        subtitle="Account, catalogue, locations, users, and audit."
      />

      {hasAny ? (
        <div className="flex flex-col gap-8">
          <GroupedList heading="Account" items={account} />
          <GroupedList heading="Shop" items={shop} />
          <GroupedList heading="Admin" items={admin} />
        </div>
      ) : (
        <EmptyState description="You do not have access to any settings." />
      )}
    </div>
  );
}
