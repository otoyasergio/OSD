import { addAuditLog } from "@/lib/audit/addAuditLog";
import { parseBoxId } from "@/lib/bikeLink/box";
import { parseBikeReading } from "@/lib/bikeLink/reading";
import { createBikeLinkAdminClient } from "@/lib/database/supabase-admin";

export type IngestResult =
  | { ok: true; readingId: string; duplicate: boolean }
  | { ok: false; status: 404 | 422; error: string };

export type ReadingPacketInput = {
  boxId: string;
  source: string;
  placeName: string;
  odometer: string;
  batteryVolts: string;
  faultCodes: string;
  recordedAt: string;
};

export function packetToReadingInput(
  body: unknown
): ({ ok: true } & ReadingPacketInput) | { ok: false; error: string } {
  if (body == null || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "Reading was not a JSON object." };
  }
  const record = body as Record<string, unknown>;
  const box = parseBoxId(String(record.boxId ?? ""));
  if (!box.ok) return box;
  return {
    ok: true,
    boxId: box.boxId,
    source: String(record.source ?? ""),
    placeName: String(record.placeName ?? ""),
    odometer: String(record.odometer ?? ""),
    batteryVolts: String(record.batteryVolts ?? ""),
    faultCodes: String(record.faultCodes ?? ""),
    recordedAt: String(record.recordedAt ?? ""),
  };
}

export async function ingestBikeLinkPacket(
  body: unknown,
  now: Date
): Promise<IngestResult> {
  const mapped = packetToReadingInput(body);
  if (!mapped.ok) return { ok: false, status: 422, error: mapped.error };

  const supabase = createBikeLinkAdminClient();
  const { data: box, error: boxError } = await supabase
    .from("bike_link_box")
    .select("motorcycle_id")
    .eq("box_id", mapped.boxId)
    .maybeSingle();
  if (boxError) return { ok: false, status: 422, error: boxError.message };
  if (!box) return { ok: false, status: 404, error: "Unknown box." };

  const { data: previous, error: previousError } = await supabase
    .from("bike_link_reading")
    .select("odometer")
    .eq("motorcycle_id", box.motorcycle_id)
    .order("recorded_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (previousError) return { ok: false, status: 422, error: previousError.message };

  const parsed = parseBikeReading({
    source: mapped.source,
    placeName: mapped.placeName,
    odometer: mapped.odometer,
    batteryVolts: mapped.batteryVolts,
    faultCodes: mapped.faultCodes,
    recordedAt: mapped.recordedAt,
    previousOdometer: previous?.odometer ?? null,
    now,
  });
  if (!parsed.ok) return { ok: false, status: 422, error: parsed.error };

  const recordedAt = parsed.reading.recordedAt.toISOString();
  const { data: inserted, error: insertError } = await supabase
    .from("bike_link_reading")
    .insert({
      motorcycle_id: box.motorcycle_id,
      box_id: mapped.boxId,
      source: parsed.reading.source,
      place_name: parsed.reading.placeName,
      odometer: parsed.reading.odometer,
      battery_volts: parsed.reading.batteryVolts,
      fault_codes: parsed.reading.faultCodes,
      recorded_at: recordedAt,
      recorded_by_user_id: null,
    })
    .select("reading_id")
    .single();

  if (insertError) {
    if (insertError.code === "23505") {
      const { data: existing, error: existingError } = await supabase
        .from("bike_link_reading")
        .select("reading_id")
        .eq("box_id", mapped.boxId)
        .eq("recorded_at", recordedAt)
        .maybeSingle();
      if (existingError || !existing) {
        return {
          ok: false,
          status: 422,
          error: existingError?.message ?? "That reading was already stored.",
        };
      }
      return { ok: true, readingId: existing.reading_id, duplicate: true };
    }
    return { ok: false, status: 422, error: insertError.message };
  }

  await addAuditLog(supabase, {
    actor_user_id: null,
    action: "bike_link.reading_received",
    entity_type: "motorcycle",
    entity_id: box.motorcycle_id,
    description: `Received a bike reading from box ${mapped.boxId}.`,
    new_value: {
      box_id: mapped.boxId,
      reading_id: inserted.reading_id,
      source: parsed.reading.source,
    },
  });

  return { ok: true, readingId: inserted.reading_id, duplicate: false };
}
