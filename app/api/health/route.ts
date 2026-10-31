import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/database/supabase-admin";
import { isPartsCanadaConfigured } from "@/lib/partsCanada/config";
import { isSquareConfigured } from "@/lib/square/config";
import { isGmailOAuthConfigured } from "@/lib/email/config";
import { isTwilioVoiceConfigured } from "@/lib/twilio/voiceConfig";
import { isWixContactsConfigured, isWixInboxSmsConfigured } from "@/lib/wix/config";
import { askOtomotoHealthStatus } from "@/lib/diagnostics/health";
import { summarizeIntegrationHealth } from "@/lib/services/healthStatus";

export const runtime = "nodejs";

type IntegrationStatus = "ok" | "missing" | "error";

/**
 * Lightweight production readiness probe. No secrets returned.
 * Use for uptime checks and post-deploy verification.
 */
export async function GET() {
  const integrations: Record<string, IntegrationStatus> = {
    supabase: "missing",
    wix: isWixContactsConfigured() ? "ok" : "missing",
    wixSms: isWixInboxSmsConfigured() ? "ok" : "missing",
    partsCanada: isPartsCanadaConfigured() ? "ok" : "missing",
    twilioVoice: isTwilioVoiceConfigured() ? "ok" : "missing",
    square: isSquareConfigured() ? "ok" : "missing",
    askOtomoto: askOtomotoHealthStatus(),
    cron: process.env.CRON_SECRET?.trim() ? "ok" : "missing",
    sentry:
      process.env.SENTRY_DSN?.trim() || process.env.NEXT_PUBLIC_SENTRY_DSN?.trim()
        ? "ok"
        : "missing",
    email: "missing",
  };

  try {
    const supabase = createAdminClient();
    const { error } = await supabase.from("location").select("location_id").limit(1);
    integrations.supabase = error ? "error" : "ok";
    if (!error && isGmailOAuthConfigured()) {
      const mailbox = await supabase
        .from("shop_mailbox")
        .select("location_id", { count: "exact", head: true });
      if (!mailbox.error && (mailbox.count ?? 0) > 0) integrations.email = "ok";
    }
  } catch {
    integrations.supabase = "error";
  }

  const { ok, degraded } = summarizeIntegrationHealth({
    supabase: integrations.supabase,
    wix: integrations.wix,
    partsCanada: integrations.partsCanada,
    cron: integrations.cron,
    askOtomoto: integrations.askOtomoto,
  });

  return NextResponse.json(
    {
      ok,
      degraded,
      timestamp: new Date().toISOString(),
      region: process.env.VERCEL_REGION ?? null,
      integrations,
    },
    { status: ok ? 200 : 503 }
  );
}
