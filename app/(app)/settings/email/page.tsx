import Link from "next/link";
import { redirect } from "next/navigation";
import { disconnectShopMailboxAction } from "./actions";
import {
  ShopMailboxPanel,
  shopMailboxNotice,
} from "@/components/settings/ShopMailboxPanel";
import { getRolePreviewContext } from "@/lib/auth/role-preview";
import { createClient } from "@/lib/database/supabase-server";
import {
  customerEmailLocationAllowed,
  gmailRedirectUri,
  isGmailOAuthConfigured,
} from "@/lib/email/config";
import { getShopMailboxAddress } from "@/lib/email/mailbox";
import { canConnectShopMailbox } from "@/lib/permissions";

export const dynamic = "force-dynamic";

export default async function ShopMailboxPage({
  searchParams,
}: {
  searchParams: Promise<{ connected?: string; error?: string }>;
}) {
  const preview = await getRolePreviewContext();
  if (!preview) redirect("/login");
  if (!canConnectShopMailbox(preview.role)) redirect("/settings");

  const params = await searchParams;
  const notice = shopMailboxNotice(params.connected === "1" ? "connected" : params.error);
  const origin = (
    process.env.NEXT_PUBLIC_APP_URL ?? "https://service.torontomoto.com"
  ).replace(/\/$/, "");
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
  if (preview.actor.active_location_id && locationAllowed && isGmailOAuthConfigured()) {
    try {
      emailAddress = await getShopMailboxAddress(preview.actor.active_location_id);
    } catch {
      emailAddress = null;
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
          Customer email
        </h1>
        <p className="mt-1 text-sm text-[var(--status-neutral)]">
          The Google mailbox that sends Ready for pickup notices and other customer email.
        </p>
      </div>

      <ShopMailboxPanel
        oauthConfigured={isGmailOAuthConfigured()}
        locationAllowed={locationAllowed}
        redirectUri={gmailRedirectUri(origin)}
        emailAddress={emailAddress}
        notice={notice}
        disconnectAction={disconnectShopMailboxAction}
      />
    </div>
  );
}
