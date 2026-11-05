import Link from "next/link";
import { redirect } from "next/navigation";
import { getRolePreviewContext } from "@/lib/auth/role-preview";
import { canManageShopRate } from "@/lib/permissions";
import { getActiveLocationShopRate } from "@/lib/services/shopRate";
import { ShopRateForm } from "@/components/settings/ShopRateForm";
import { updateShopRateAction } from "@/app/(app)/settings/shop_rate/actions";

export const dynamic = "force-dynamic";

export default async function ShopRateSettingsPage() {
  const preview = await getRolePreviewContext();
  if (!preview) redirect("/login");
  if (!canManageShopRate(preview.role)) redirect("/settings");

  const shop = await getActiveLocationShopRate();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          href="/settings"
          className="text-sm text-[var(--status-neutral)] underline-offset-2 hover:underline"
        >
          ← Settings
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground">
          Shop rate
        </h1>
        <p className="mt-1 text-sm text-[var(--status-neutral)]">
          Owner-only. Hourly labour rate for {shop.location_name}. Intake uses this
          amount when a service does not have a fixed catalogue price.
        </p>
      </div>

      <ShopRateForm
        hourlyRate={shop.hourly_rate}
        locationName={shop.location_name}
        action={updateShopRateAction}
      />
    </div>
  );
}
