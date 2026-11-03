import { describe, expect, it } from "vitest";
import { packetToReadingInput } from "@/lib/bikeLink/ingest";
import { parseBikeReading } from "@/lib/bikeLink/reading";

describe("packetToReadingInput", () => {
  it("maps the mailbox object onto parseBikeReading fields", () => {
    const input = packetToReadingInput({
      boxId: "TM-BL-0007",
      source: "shop_bay",
      placeName: "99 River Street",
      odometer: "",
      batteryVolts: "12.6",
      faultCodes: "",
      recordedAt: "2026-11-02T21:15:00Z",
    });
    expect(input).toEqual({
      ok: true,
      boxId: "TM-BL-0007",
      source: "shop_bay",
      placeName: "99 River Street",
      odometer: "",
      batteryVolts: "12.6",
      faultCodes: "",
      recordedAt: "2026-11-02T21:15:00Z",
    });
  });

  it("rejects a packet that is not an object", () => {
    expect(packetToReadingInput(null).ok).toBe(false);
  });

  it("accepts a voltage when the odometer was not read", () => {
    const mapped = packetToReadingInput({
      boxId: "TM-BL-0007",
      source: "home",
      placeName: "",
      odometer: "",
      batteryVolts: "12.2",
      faultCodes: "",
      recordedAt: "2026-11-02T21:15:00Z",
    });
    expect(mapped.ok).toBe(true);
    if (!mapped.ok) return;
    const parsed = parseBikeReading({
      ...mapped,
      previousOdometer: null,
      now: new Date("2026-11-02T21:20:00Z"),
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.reading.odometer).toBeNull();
    expect(parsed.reading.batteryVolts).toBe(12.2);
  });
});
