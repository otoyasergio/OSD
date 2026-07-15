import { NextResponse } from "next/server";
import { getWixWebhookSecret, isWixWebhookConfigured } from "@/lib/wix/config";
import { upsertCustomerFromWixWebhook } from "@/lib/services/wixContacts";
import type { WixWebhookContactPayload } from "@/lib/wix/types";
import { clientIp, rateLimit } from "@/lib/security/rateLimit";
import { logger, newRequestId } from "@/lib/security/logger";
import { captureException } from "@/lib/security/sentry";

export const runtime = "nodejs";

/**
 * Inbound contact sync from Wix Automations / Velo HTTP.
 * Auth: Authorization: Bearer <WIX_WEBHOOK_SECRET>
 * Fail-closed if secret is missing.
 *
 * Body:
 * {
 *   "event": "contact.created" | "contact.updated",
 *   "contact": {
 *     "id": "<wix contact id>",
 *     "firstName": "...",
 *     "lastName": "...",
 *     "email": "...",
 *     "phone": "..."
 *   }
 * }
 */
export async function POST(request: Request) {
  const requestId = newRequestId();
  const ip = clientIp(request);
  const limited = rateLimit({
    key: `wix-contacts-webhook:${ip}`,
    limit: 60,
    windowMs: 60_000,
  });
  if (!limited.success) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  if (!isWixWebhookConfigured()) {
    logger.error("Wix contacts webhook secret missing — fail closed", {
      requestId,
    });
    return NextResponse.json({ error: "Webhook secret not configured" }, { status: 503 });
  }

  const expected = getWixWebhookSecret();
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${expected}`) {
    logger.warn("Wix contacts webhook unauthorized", { requestId, ip });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let payload: WixWebhookContactPayload;
  try {
    payload = (await request.json()) as WixWebhookContactPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  try {
    const result = await upsertCustomerFromWixWebhook(payload);
    return NextResponse.json({
      ok: true,
      customer_id: result.customer_id,
      created: result.created,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "WIX_WEBHOOK_FAILED";
    const status =
      message === "WIX_WEBHOOK_INVALID" || message === "WIX_WEBHOOK_CONTACT_REQUIRED"
        ? 400
        : 500;
    if (status === 500) {
      captureException(error, { requestId, route: "wix-contacts-webhook" });
      logger.error("Wix contacts webhook failed", { requestId, error: message });
    }
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
