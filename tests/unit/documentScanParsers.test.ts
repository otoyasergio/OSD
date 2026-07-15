import { describe, it, expect } from "vitest";
import { parseAamvaBarcode } from "@/lib/scan/aamva";
import { parseOwnershipText } from "@/lib/scan/ownershipText";

describe("parseAamvaBarcode", () => {
  it("maps DAC/DCS/DAQ fields", () => {
    const raw = [
      "@",
      "ANSI 636000090002DL00410278",
      "DCSSMITH",
      "DACJOHN",
      "DADMICHAEL",
      "DAG123 MAIN ST",
      "DAITORONTO",
      "DAJON",
      "DAK M4B1B3",
      "DAQD1234567",
    ].join("\n");
    const draft = parseAamvaBarcode(raw);
    expect(draft).toMatchObject({
      first_name: "JOHN",
      last_name: "SMITH",
      license_number: "D1234567",
    });
    expect(draft?.raw_notes).toContain("DL #:");
  });

  it("returns null for empty parse", () => {
    expect(parseAamvaBarcode("")).toBeNull();
    expect(parseAamvaBarcode("hello world")).toBeNull();
  });
});

describe("parseOwnershipText", () => {
  it("extracts VIN year make model", () => {
    const draft = parseOwnershipText(
      "ONTARIO OWNERSHIP 2019 HONDA CBR600RR VIN: JH2PC3500KK200001 PLATE: AB12CD"
    );
    expect(draft.vin).toBe("JH2PC3500KK200001");
    expect(draft.year).toBe(2019);
    expect(draft.make).toBe("HONDA");
    expect(draft.plate).toBe("AB12CD");
  });

  it("returns empty object for blank text", () => {
    expect(parseOwnershipText("")).toEqual({});
  });
});
