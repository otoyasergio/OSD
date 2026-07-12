import { NextResponse } from "next/server";
import { syncPartsCanadaCatalog } from "@/lib/services/partsCanadaCatalog";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Daily Parts Canada inventory sync.
 * Protect with CRON_SECRET (Authorization: Bearer <secret> or ?secret=).
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "CRON_SECRET is not configured" },
      { status: 500 }
    );
  }

  const authHeader = request.headers.get("authorization");
  const url = new URL(request.url);
  const querySecret = url.searchParams.get("secret");
  const bearerOk = authHeader === `Bearer ${secret}`;
  const queryOk = querySecret === secret;

  if (!bearerOk && !queryOk) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await syncPartsCanadaCatalog({ triggeredBy: "cron" });
    return NextResponse.json({ ok: true, row_count: result.row_count });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "PARTS_CANADA_SYNC_FAILED";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
