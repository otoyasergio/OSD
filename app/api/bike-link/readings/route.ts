import { ingestBikeLinkPacket } from "@/lib/bikeLink/ingest";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const secret = process.env.BIKE_LINK_INGEST_SECRET?.trim();
  if (!secret) {
    return Response.json(
      { ok: false, error: "BIKE_LINK_INGEST_SECRET is not configured" },
      { status: 500 }
    );
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: "Reading was not a JSON object." }, { status: 422 });
  }

  const result = await ingestBikeLinkPacket(body, new Date());
  if (!result.ok) {
    return Response.json({ ok: false, error: result.error }, { status: result.status });
  }
  return Response.json(
    { ok: true, readingId: result.readingId, duplicate: result.duplicate },
    { status: result.duplicate ? 200 : 201 }
  );
}
