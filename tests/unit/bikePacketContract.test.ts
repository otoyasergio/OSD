import { describe, expect, it } from "vitest";
import { bikePacket, readyForRadio } from "@/firmware/bike/packet_contract";

describe("bikePacket", () => {
  it("keeps unread fields empty and the radio text within 240 bytes", () => {
    const packet = bikePacket({
      boxId: "TM-BL-0007",
      odometer: null,
      batteryVolts: "",
      faultCodes: null,
      recordedAt: "2026-11-02T21:15:00Z",
      clockSet: true,
    });
    expect(packet).toEqual({
      boxId: "TM-BL-0007",
      odometer: "",
      batteryVolts: "",
      faultCodes: "",
      recordedAt: "2026-11-02T21:15:00Z",
      clockSet: true,
    });
    expect(Object.keys(packet)).toEqual([
      "boxId",
      "odometer",
      "batteryVolts",
      "faultCodes",
      "recordedAt",
      "clockSet",
    ]);
    const text = JSON.stringify(packet);
    expect(text.length).toBeLessThanOrEqual(240);
    expect(text).toContain('"clockSet":true');
    expect(readyForRadio(packet)).toBe(true);
  });

  it("holds a full reading under the radio limit", () => {
    const packet = bikePacket({
      boxId: "TM-BL-0007",
      odometer: "48210",
      batteryVolts: "12.6",
      faultCodes: "P0335 C14",
      recordedAt: "2026-11-02T21:15:00Z",
      clockSet: true,
    });
    expect(JSON.stringify(packet).length).toBeLessThanOrEqual(240);
    expect(readyForRadio(packet)).toBe(true);
  });

  it("is not ready for the radio until the clock is set", () => {
    const packet = bikePacket({
      boxId: "TM-BL-0007",
      odometer: "48210",
      batteryVolts: "12.6",
      faultCodes: "P0335 C14",
      recordedAt: "2026-11-02T21:15:00Z",
      clockSet: false,
    });
    expect(JSON.stringify(packet)).toContain('"odometer":"48210"');
    expect(JSON.stringify(packet)).toContain('"clockSet":false');
    expect(readyForRadio(packet)).toBe(false);
  });
});
