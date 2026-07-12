import { NextResponse } from "next/server";
import { processSquareWebhookEvent } from "@/lib/services/squareBilling";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    const eventId = payload.event_id ?? payload.eventId ?? crypto.randomUUID();
    await processSquareWebhookEvent({
      type: payload.type ?? "unknown",
      event_id: eventId,
      data: payload.data ?? {},
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "WEBHOOK_FAILED";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
