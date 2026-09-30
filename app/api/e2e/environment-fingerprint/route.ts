import "server-only";

import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import {
  E2E_ENV_GUARD_HEADER,
  fingerprintSupabaseTarget,
} from "@/lib/e2e/environmentFingerprintCore";

function secretMatches(actual: string | null, expected: string): boolean {
  if (!actual) return false;
  const actualBytes = Buffer.from(actual);
  const expectedBytes = Buffer.from(expected);
  return (
    actualBytes.length === expectedBytes.length &&
    timingSafeEqual(actualBytes, expectedBytes)
  );
}

function configured(...values: Array<string | undefined>): boolean {
  return values.some((value) => Boolean(value?.trim()));
}

export async function GET(request: Request): Promise<Response> {
  const guardSecret = process.env.E2E_ENV_GUARD_SECRET?.trim() ?? "";
  if (
    process.env.VERCEL_ENV === "production" ||
    process.env.E2E_ALLOW_MUTATION !== "1" ||
    !guardSecret
  ) {
    return new Response(null, { status: 404 });
  }
  if (!secretMatches(request.headers.get(E2E_ENV_GUARD_HEADER), guardSecret)) {
    return new Response(null, { status: 403 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!supabaseUrl?.trim()) return new Response(null, { status: 500 });

  return NextResponse.json(
    {
      supabaseTargetFingerprint: fingerprintSupabaseTarget(supabaseUrl),
      openAIConfigured: configured(process.env.OPENAI_API_KEY),
      twilioConfigured: configured(
        process.env.TWILIO_ACCOUNT_SID,
        process.env.TWILIO_AUTH_TOKEN,
        process.env.TWILIO_API_KEY_SID,
        process.env.TWILIO_API_KEY_SECRET,
        process.env.TWILIO_MESSAGING_SERVICE_SID,
        process.env.TWILIO_FROM_NUMBER,
        process.env.TWILIO_TWIML_APP_SID
      ),
      resendConfigured: configured(process.env.RESEND_API_KEY),
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
