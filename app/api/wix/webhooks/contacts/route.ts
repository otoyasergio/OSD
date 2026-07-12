import { NextResponse } from "next/server";
import { getWixWebhookSecret, isWixWebhookConfigured } from "@/lib/wix/config";
import { upsertCustomerFromWixWebhook } from "@/lib/services/wixContacts";
import type { WixWebhookContactPayload } from "@/lib/wix/types";

export const runtime = "nodejs";

/**
 * Inbound contact sync from Wix Automations / Velo HTTP.
 * Auth: Authorization: Bearer <WIX_WEBHOOK_SECRET>
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
  if (!isWixWebhookConfigured()) {
    return NextResponse.json(
      { error: "WIX_WEBHOOK_SECRET is not configured" },
      { status: 500 }
    );
  }

  const expected = getWixWebhookSecret();
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${expected}`) {
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
    const message =
      error instanceof Error ? error.message : "WIX_WEBHOOK_FAILED";
    const status =
      message === "WIX_WEBHOOK_INVALID" ||
      message === "WIX_WEBHOOK_CONTACT_REQUIRED"
        ? 400
        : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
