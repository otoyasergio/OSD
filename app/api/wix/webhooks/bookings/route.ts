import { NextResponse } from "next/server";
import { processWixBookingWebhook } from "@/lib/services/bookings";

export const runtime = "nodejs";

/**
 * Wix Bookings webhook → create scheduled work order stub.
 * Protect with WIX_WEBHOOK_SECRET (Authorization: Bearer).
 */
export async function POST(request: Request) {
  const secret = process.env.WIX_WEBHOOK_SECRET;
  if (secret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const locationId = process.env.WIX_DEFAULT_LOCATION_ID;
  if (!locationId) {
    return NextResponse.json(
      { error: "WIX_DEFAULT_LOCATION_ID is not configured" },
      { status: 500 }
    );
  }

  try {
    const payload = (await request.json()) as {
      bookingId?: string;
      data?: { bookingId?: string };
    };
    const bookingId = payload.bookingId ?? payload.data?.bookingId;
    if (!bookingId) {
      return NextResponse.json({ error: "bookingId required" }, { status: 400 });
    }

    const result = await processWixBookingWebhook({
      bookingId,
      locationId,
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "WEBHOOK_FAILED";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
