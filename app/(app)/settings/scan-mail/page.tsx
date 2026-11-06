import Link from "next/link";
import { redirect } from "next/navigation";
import { disconnectScanMailboxAction } from "./actions";
import {
  ScanMailboxPanel,
  scanMailboxNotice,
} from "@/components/settings/ScanMailboxPanel";
import { getRolePreviewContext } from "@/lib/auth/role-preview";
import { createClient } from "@/lib/database/supabase-server";
import { customerEmailLocationAllowed, isGmailOAuthConfigured } from "@/lib/email/config";
import { SCAN_REPORT_ADDRESS } from "@/lib/email/scanReport";
import { getScanMailboxAddress, listRecentScanReports } from "@/lib/email/scanMailbox";
import { canConnectShopMailbox } from "@/lib/permissions";

export const dynamic = "force-dynamic";

export default async function ScanMailboxPage({
  searchParams,
}: {
  searchParams: Promise<{ connected?: string; error?: string }>;
}) {
  const preview = await getRolePreviewContext();
  if (!preview) redirect("/login");
  if (!canConnectShopMailbox(preview.role)) redirect("/settings");

  const params = await searchParams;
  const notice = scanMailboxNotice(params.connected === "1" ? "connected" : params.error);
  let locationCode: string | null = null;
  if (preview.actor.active_location_id) {
    const supabase = await createClient();
    const { data } = await supabase
      .from("location")
      .select("code")
      .eq("location_id", preview.actor.active_location_id)
      .maybeSingle();
    locationCode = data?.code ?? null;
  }
  const locationAllowed = customerEmailLocationAllowed(locationCode);
  let emailAddress: string | null = null;
  let reports: Awaited<ReturnType<typeof listRecentScanReports>> = [];
  if (preview.actor.active_location_id && locationAllowed && isGmailOAuthConfigured()) {
    try {
      emailAddress = await getScanMailboxAddress(preview.actor.active_location_id);
      if (emailAddress) {
        reports = await listRecentScanReports(preview.actor.active_location_id);
      }
    } catch {
      emailAddress = null;
      reports = [];
    }
  }

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
          Scan reports
        </h1>
        <p className="mt-1 text-sm text-[var(--status-neutral)]">
          TopGuru sends scan reports to {SCAN_REPORT_ADDRESS}. Customer email stays on its
          own mailbox.
        </p>
      </div>

      <ScanMailboxPanel
        oauthConfigured={isGmailOAuthConfigured()}
        locationAllowed={locationAllowed}
        emailAddress={emailAddress}
        reports={reports}
        notice={notice}
        disconnectAction={disconnectScanMailboxAction}
      />
    </div>
  );
}
