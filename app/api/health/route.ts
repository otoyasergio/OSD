import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/database/supabase-admin";
import { isPartsCanadaConfigured } from "@/lib/partsCanada/config";
import { isSquareConfigured } from "@/lib/square/config";
import { isTwilioConfigured } from "@/lib/twilio/config";
import { isTwilioVoiceConfigured } from "@/lib/twilio/voiceConfig";
import { isWixContactsConfigured } from "@/lib/wix/config";

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
    partsCanada: isPartsCanadaConfigured() ? "ok" : "missing",
    twilioSms: isTwilioConfigured() ? "ok" : "missing",
    twilioVoice: isTwilioVoiceConfigured() ? "ok" : "missing",
    square: isSquareConfigured() ? "ok" : "missing",
    cron: process.env.CRON_SECRET?.trim() ? "ok" : "missing",
    sentry:
      process.env.SENTRY_DSN?.trim() || process.env.NEXT_PUBLIC_SENTRY_DSN?.trim()
        ? "ok"
        : "missing",
  };

  try {
    const supabase = createAdminClient();
    const { error } = await supabase.from("location").select("location_id").limit(1);
    integrations.supabase = error ? "error" : "ok";
  } catch {
    integrations.supabase = "error";
  }

  const ok =
    integrations.supabase === "ok" &&
    integrations.cron === "ok" &&
    integrations.wix === "ok" &&
    integrations.partsCanada === "ok";

  return NextResponse.json(
    {
      ok,
      timestamp: new Date().toISOString(),
      region: process.env.VERCEL_REGION ?? null,
      integrations,
    },
    { status: ok ? 200 : 503 }
  );
}
