import { redirect } from "next/navigation";
import { getRolePreviewContext } from "@/lib/auth/role-preview";
import {
  canViewBillingArea,
  canViewBillingTab,
  defaultBillingTab,
  type BillingTab,
} from "@/lib/permissions/checks";
import {
  buildBillingDeskStats,
  listBillingBoardForLocation,
} from "@/lib/services/billingBoard";
import { PageHeader } from "@/components/ui/PageHeader";
import { BillingTabs } from "@/components/billing/BillingTabs";
import { BillingCollectionsBoard } from "@/components/billing/BillingCollectionsBoard";
import { BillingMoneyDeskStats } from "@/components/billing/BillingMoneyDeskStats";
import { BillingLedgerTable } from "@/components/billing/BillingLedgerTable";

export const dynamic = "force-dynamic";

function parseTab(value: string | undefined): BillingTab | null {
  if (value === "collections" || value === "money_desk" || value === "ledger") {
    return value;
  }
  return null;
}

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const preview = await getRolePreviewContext();
  if (!preview) redirect("/login");
  const { actor: user, role: viewRole } = preview;
  if (!canViewBillingArea(viewRole)) redirect("/dashboard");
  if (!user.active_location_id) redirect("/dashboard");

  const params = await searchParams;
  const requested = parseTab(params.tab);
  const fallback = defaultBillingTab(viewRole);
  const active =
    requested && canViewBillingTab(viewRole, requested) ? requested : fallback;

  if (requested && requested !== active) {
    redirect(`/billing?tab=${active}`);
  }

  const allowed: BillingTab[] = (
    ["collections", "money_desk", "ledger"] as BillingTab[]
  ).filter((tab) => canViewBillingTab(viewRole, tab));

  const items = await listBillingBoardForLocation(user.active_location_id);
  const stats = buildBillingDeskStats(items);
  const showQuickActions = canViewBillingTab(viewRole, "money_desk");

  return (
    <div className="page-stack page-stack--wide">
      <PageHeader
        title="Billing"
        subtitle="Estimates, invoices, and collections for this location — money still posts through Square on each work order."
      />

      <BillingTabs active={active} allowed={allowed} />

      {active === "money_desk" ? <BillingMoneyDeskStats stats={stats} /> : null}

      {active === "ledger" ? (
        <BillingLedgerTable items={items} />
      ) : (
        <BillingCollectionsBoard
          items={items}
          showQuickActions={showQuickActions && active === "money_desk"}
        />
      )}
    </div>
  );
}
