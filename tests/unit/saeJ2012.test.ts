import { describe, expect, it } from "vitest";

import {
  codesFromObdPayload,
  decodeSaeJ2012,
  encodeSaeJ2012,
  faultCodeLabel,
  saeJ2012System,
} from "@/lib/bikeLink/saeJ2012";

describe("SAE J2012 codec", () => {
  it.each([
    ["P0217", [0x02, 0x17, 0x00]],
    ["C1234", [0x52, 0x34, 0x00]],
    ["U0100", [0xc1, 0x00, 0x00]],
    ["B1000", [0x90, 0x00, 0x00]],
    ["P0A80", [0x0a, 0x80, 0x00]],
  ])("round-trips %s the way the AWS sample encodes it", (code, bytes) => {
    expect(encodeSaeJ2012(code)).toEqual(bytes);
    expect(decodeSaeJ2012(bytes[0], bytes[1])).toBe(code);
  });

  it("leaves a short Triumph code unlabeled", () => {
    expect(encodeSaeJ2012("C14")).toBeNull();
    expect(saeJ2012System("C14")).toBeNull();
    expect(faultCodeLabel("C14")).toBe("C14");
    expect(faultCodeLabel("P0335")).toBe("P0335 (ignition system)");
  });

  it("names the system from the sample's category notes", () => {
    expect(saeJ2012System("P0171")).toBe("fuel and air");
    expect(saeJ2012System("P0335")).toBe("ignition system");
    expect(saeJ2012System("P0420")).toBe("emissions system");
    expect(saeJ2012System("P0A80")).toBe("high-voltage battery");
    expect(saeJ2012System("P0B00")).toBe("hybrid drive");
    expect(saeJ2012System("C1234")).toBe("chassis");
    expect(saeJ2012System("B1000")).toBe("body");
    expect(saeJ2012System("U0100")).toBe("network");
    expect(saeJ2012System("P0670")).toBeNull();
  });
});

describe("OBD payload", () => {
  it("reads mode 03 pairs and skips an empty pair", () => {
    expect(codesFromObdPayload([0x43, 0x00, 0x00, 0x02, 0x17])).toEqual(["P0217"]);
  });

  it("reads a confirmed UDS status record and drops a pending-only one", () => {
    expect(
      codesFromObdPayload([
        0x59, 0x02, 0xff, 0x02, 0x17, 0x00, 0x09, 0x52, 0x34, 0x00, 0x04,
      ])
    ).toEqual(["P0217"]);
  });

  it("keeps a confirmed code and ignores a negative response", () => {
    expect(codesFromObdPayload([0x59, 0x02, 0xff, 0xc1, 0x00, 0x00, 0x08])).toEqual([
      "U0100",
    ]);
    expect(codesFromObdPayload([0x7f, 0x03, 0x11])).toEqual([]);
  });
});
