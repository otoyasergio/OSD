import { NextResponse } from "next/server";
import { getWixWebhookSecret, isWixWebhookConfigured } from "@/lib/wix/config";
import { handleInvoiceWebhook } from "@/lib/services/wixInvoices";
import type { WixInvoiceRecord } from "@/lib/wix/invoicePayload";
import { clientIp, rateLimit } from "@/lib/security/rateLimit";
import { logger, newRequestId } from "@/lib/security/logger";
import { captureException } from "@/lib/security/sentry";
import { bearerAuthorizationMatches } from "@/lib/security/webhooks";

export const runtime = "nodejs";

/**
 * Inbound invoice sync from Wix Automations.
 * Auth: Authorization: Bearer <WIX_WEBHOOK_SECRET>
 * Fail-closed if the secret is missing.
 * The body is only an id and an event name. The invoice is loaded from Wix,
 * and nothing is written while the invoice switches are off.
 */
export async function POST(request: Request) {
  const requestId = newRequestId();
  const ip = clientIp(request);
  const limited = rateLimit({
    key: `wix-invoices-webhook:${ip}`,
    limit: 60,
    windowMs: 60_000,
  });
  if (!limited.success) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  if (!isWixWebhookConfigured()) {
    logger.error("Wix invoice webhook secret missing — fail closed", { requestId });
    return NextResponse.json({ error: "Webhook secret not configured" }, { status: 503 });
  }

  const expected = getWixWebhookSecret();
  const authHeader = request.headers.get("authorization");
  if (!bearerAuthorizationMatches(authHeader, expected)) {
    logger.warn("Wix invoice webhook unauthorized", { requestId, ip });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let payload: {
    event?: string;
    invoice?: WixInvoiceRecord;
    invoiceId?: string;
    revision?: string;
  };
  try {
    payload = (await request.json()) as typeof payload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  try {
    const result = await handleInvoiceWebhook(payload);
    return NextResponse.json({ ok: true, ignored: result.ignored });
  } catch (error) {
    const message = error instanceof Error ? error.message : "WIX_WEBHOOK_FAILED";
    const status = message === "WIX_WEBHOOK_INVOICE_REQUIRED" ? 400 : 500;
    if (status === 500) {
      captureException(error, { requestId, route: "wix-invoices-webhook" });
      logger.error("Wix invoice webhook failed", { requestId, error: message });
    }
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
