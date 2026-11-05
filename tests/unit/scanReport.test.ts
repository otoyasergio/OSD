import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  chooseInspectionForScan,
  chooseMotorcycleForScan,
  diagnosticFromScan,
  diagnosticToCreate,
  filingsForUnreadMail,
  mileageDecision,
  readOdometer,
  readTopGuruReport,
  scanAddressAllowed,
  scanCustomerLines,
  textFromGmailMessage,
  vinMismatchNote,
} from "@/lib/email/scanReport";

const open = {
  inspectionId: "insp-1",
  workOrderId: "wo-1",
  workOrderNumber: "WO-1042",
  motorcycleId: "bike-1",
  vin: "1HD1BJY174Y023456",
};

describe("readTopGuruReport", () => {
  it("keeps each code and the description on its line", () => {
    const report = readTopGuruReport(
      "VIN 1HD1BJY174Y023456\nP0301 Misfire detected\nC0561"
    );
    expect(report.outcome).toBe("codes");
    expect(report.vin).toBe("1HD1BJY174Y023456");
    expect(report.codes).toEqual([
      { code: "P0301", description: "Misfire detected" },
      { code: "C0561", description: "chassis" },
    ]);
  });

  it("reads a clean scan as no codes", () => {
    expect(readTopGuruReport("Auto Scan\nNo fault codes were found.").outcome).toBe(
      "no_codes"
    );
  });

  it("reads a failed connection without inventing codes", () => {
    const report = readTopGuruReport("Communication error. Unable to connect.");
    expect(report.outcome).toBe("no_connection");
    expect(report.codes).toEqual([]);
  });

  it("holds a report whose text has no codes and no clear result", () => {
    expect(readTopGuruReport("Diagnostic report attached.").outcome).toBe(
      "needs_confirmation"
    );
  });

  it("reads a Topdon full system report", () => {
    const text = readFileSync("tests/fixtures/topguru-r1250gs.txt", "utf8");
    const report = readTopGuruReport(text);
    expect(report.outcome).toBe("codes");
    expect(report.vin).toBe("WB10J9303KZH99235");
    expect(report.codes.map((code) => code.code)).toEqual([
      "480682",
      "481F84",
      "80401D",
      "E11436",
      "E11438",
      "E11432",
      "E11422",
      "E11442",
    ]);
    expect(report.codes[0]?.description).toBe(
      "ABS: Pullaway assistant deactivated (not currently present)"
    );
    expect(report.codes.find((code) => code.code === "E11432")?.description).toBe(
      "Instrument panel: No CAN message for anti-theft alarm status (from the DWA) (not currently present)"
    );
    expect(report.codes.find((code) => code.code === "E11422")?.description).toBe(
      "Instrument panel: No CAN message for vehicle speed (from the ABS or GM) (not currently present)"
    );
    expect(readOdometer(text)).toEqual({ value: 51382, unit: "mi" });
  });

  it("reads a Topdon report with no DTCs as no codes", () => {
    expect(
      readTopGuruReport(
        "VIN WB10J9303KZH99235\nAltogether 0 DTCs were found.\nDME(Engine Control)\nNo fault"
      ).outcome
    ).toBe("no_codes");
  });
});

describe("chooseInspectionForScan", () => {
  it("files a report onto the open inspection with the same VIN", () => {
    const other = {
      ...open,
      inspectionId: "insp-2",
      workOrderId: "wo-2",
      vin: "JH2SC5912KK123456",
    };
    const chosen = chooseInspectionForScan({ vin: "1HD1BJY174Y023456" }, [open, other]);
    expect(chosen?.workOrderId).toBe("wo-1");
  });

  it("files a report with no VIN when one inspection is open", () => {
    expect(chooseInspectionForScan({ vin: null }, [open])?.inspectionId).toBe("insp-1");
  });

  it("holds a report when two open inspections have no VIN to match", () => {
    const second = { ...open, inspectionId: "insp-2", workOrderId: "wo-2", vin: null };
    expect(chooseInspectionForScan({ vin: null }, [open, second])).toBeNull();
  });

  it("does not file a report onto an inspection with a different VIN", () => {
    expect(chooseInspectionForScan({ vin: "JH2SC5912KK123456" }, [open])).toBeNull();
  });
});

describe("chooseMotorcycleForScan", () => {
  const bike = { motorcycleId: "bike-1", vin: "WB10J9303KZH99235" };

  it("files a report onto the bike when no visit is open", () => {
    expect(
      chooseMotorcycleForScan({ vin: "WB10J9303KZH99235" }, [bike])?.motorcycleId
    ).toBe("bike-1");
  });

  it("does not pick a bike when two profiles share the VIN", () => {
    const second = { motorcycleId: "bike-2", vin: "WB10J9303KZH99235" };
    expect(
      chooseMotorcycleForScan({ vin: "WB10J9303KZH99235" }, [bike, second])
    ).toBeNull();
  });

  it("does not use the only bike when the report has no VIN", () => {
    expect(chooseMotorcycleForScan({ vin: null }, [bike])).toBeNull();
  });
});

describe("scanAddressAllowed", () => {
  it("accepts only scans@torontomoto.com", () => {
    expect(scanAddressAllowed("scans@torontomoto.com", "info@torontomoto.com")).toBe(
      true
    );
    expect(scanAddressAllowed("Scans@TorontoMoto.com", null)).toBe(true);
    expect(scanAddressAllowed("other@torontomoto.com", null)).toBe(false);
    expect(scanAddressAllowed("info@torontomoto.com", "info@torontomoto.com")).toBe(
      false
    );
  });

  it("refuses scans@torontomoto.com when that address also sends customer email", () => {
    expect(scanAddressAllowed("scans@torontomoto.com", "scans@torontomoto.com")).toBe(
      false
    );
  });
});

describe("textFromGmailMessage", () => {
  it("reads the plain-text part and ignores a PDF attachment", () => {
    const parsed = textFromGmailMessage({
      id: "m1",
      snippet: "snippet",
      payload: {
        mimeType: "multipart/mixed",
        headers: [
          { name: "Subject", value: "TopScan report" },
          { name: "From", value: "TopGuru <reports@topdon.example>" },
        ],
        parts: [
          {
            mimeType: "text/plain",
            body: {
              data: Buffer.from("P0301 Misfire", "utf8").toString("base64url"),
            },
          },
          {
            mimeType: "application/pdf",
            filename: "report.pdf",
            body: { attachmentId: "att-1" },
          },
        ],
      },
    });

    expect(parsed.subject).toBe("TopScan report");
    expect(parsed.from).toBe("TopGuru <reports@topdon.example>");
    expect(parsed.text).toContain("P0301 Misfire");
    expect(parsed.text).not.toContain("report.pdf");
  });
});

describe("scanCustomerLines", () => {
  it("lists each code and its description", () => {
    expect(
      scanCustomerLines({
        outcome: "codes",
        codes: [
          { code: "P0301", description: "Misfire detected" },
          { code: "C0561", description: "chassis" },
        ],
      })
    ).toEqual(["P0301 Misfire detected", "C0561 chassis"]);
  });

  it("uses the fixed sentences for a clean scan and a failed connection", () => {
    expect(scanCustomerLines({ outcome: "no_codes", codes: [] })).toEqual([
      "No fault codes were found.",
    ]);
    expect(scanCustomerLines({ outcome: "no_connection", codes: [] })).toEqual([
      "No connection established with the bike.",
    ]);
  });

  it("does not invent a sentence when the report still needs a look", () => {
    expect(scanCustomerLines({ outcome: "needs_confirmation", codes: [] })).toEqual([]);
  });
});

describe("readOdometer", () => {
  it("reads kilometres and miles from the report", () => {
    expect(readOdometer("Odometer: 12,345 km")).toEqual({ value: 12345, unit: "km" });
    expect(readOdometer("Mileage 8200 miles")).toEqual({ value: 8200, unit: "mi" });
    expect(readOdometer("Distance Traveled: 51381.707 miles")).toEqual({
      value: 51382,
      unit: "mi",
    });
  });

  it("ignores charging voltage", () => {
    expect(readOdometer("Charging voltage: 14.4 V\nBattery voltage 12.6 V")).toBeNull();
  });
});

describe("mileageDecision", () => {
  it("fills an empty work order mileage", () => {
    expect(
      mileageDecision({
        reported: { value: 12345, unit: "km" },
        current: null,
        currentUnit: "km",
      })
    ).toEqual({ action: "fill", value: 12345, unit: "km" });
  });

  it("asks the tech to choose when the numbers disagree", () => {
    expect(
      mileageDecision({
        reported: { value: 18000, unit: "km" },
        current: 12000,
        currentUnit: "km",
      })
    ).toEqual({
      action: "choose",
      reportedValue: 18000,
      reportedUnit: "km",
      current: 12000,
      currentUnit: "km",
    });
  });

  it("asks the tech to choose when the units disagree", () => {
    expect(
      mileageDecision({
        reported: { value: 12000, unit: "mi" },
        current: 12000,
        currentUnit: "km",
      }).action
    ).toBe("choose");
  });

  it("keeps a matching mileage", () => {
    expect(
      mileageDecision({
        reported: { value: 12000, unit: "km" },
        current: 12000,
        currentUnit: "km",
      })
    ).toEqual({ action: "none" });
  });
});

describe("vinMismatchNote", () => {
  it("notes a different VIN and stays quiet when they match", () => {
    expect(vinMismatchNote("JH2SC5912KK123456", "1HD1BJY174Y023456")).toBe(
      "The report VIN does not match this work order."
    );
    expect(vinMismatchNote("1HD1BJY174Y023456", "1hd1bjy174y023456")).toBeNull();
  });
});

describe("diagnosticFromScan", () => {
  it("plans one unpriced Diagnostic when the scan has codes", () => {
    expect(
      diagnosticFromScan({
        outcome: "codes",
        codes: [{ code: "P0301", description: "Misfire detected" }],
      })
    ).toEqual({
      description: "Diagnostic",
      severity: "immediate_attention",
      notes: "P0301 Misfire detected",
    });
  });

  it("plans none when the scan has no codes", () => {
    expect(diagnosticFromScan({ outcome: "no_codes", codes: [] })).toBeNull();
    expect(diagnosticFromScan({ outcome: "no_connection", codes: [] })).toBeNull();
    expect(diagnosticFromScan(null)).toBeNull();
    expect(
      diagnosticToCreate(
        { outcome: "codes", codes: [{ code: "P0301", description: "Misfire detected" }] },
        true
      )
    ).toBeNull();
  });
});

describe("filingsForUnreadMail", () => {
  it("skips a message that was already filed and files the new one", () => {
    const filings = filingsForUnreadMail({
      messages: [
        { id: "old", text: "P0301 Misfire" },
        { id: "new", text: "VIN 1HD1BJY174Y023456\nNo fault codes" },
      ],
      waiting: [open],
      bikes: [],
      alreadyFiledIds: ["old"],
    });

    expect(filings).toHaveLength(1);
    expect(filings[0]).toMatchObject({
      gmailMessageId: "new",
      outcome: "no_codes",
      workOrderId: "wo-1",
      inspectionId: "insp-1",
      motorcycleId: "bike-1",
    });
  });

  it("files a VIN match onto the bike profile when no inspection is open", () => {
    const filings = filingsForUnreadMail({
      messages: [{ id: "scan-1", text: "VIN WB10J9303KZH99235\n480682 ABS: Pullaway" }],
      waiting: [],
      bikes: [{ motorcycleId: "bike-1", vin: "WB10J9303KZH99235" }],
      alreadyFiledIds: [],
    });

    expect(filings[0]).toMatchObject({
      outcome: "codes",
      workOrderId: null,
      inspectionId: null,
      motorcycleId: "bike-1",
    });
  });
});
