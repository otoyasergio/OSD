import { describe, expect, it } from "vitest";
import {
  chooseInspectionForScan,
  filingsForUnreadMail,
  readTopGuruReport,
  scanAddressAllowed,
  textFromGmailMessage,
} from "@/lib/email/scanReport";

const open = {
  inspectionId: "insp-1",
  workOrderId: "wo-1",
  workOrderNumber: "WO-1042",
  vin: "1HD1BJY174Y023456",
};

describe("readTopGuruReport", () => {
  it("keeps each code and the description on its line", () => {
    const report = readTopGuruReport("VIN 1HD1BJY174Y023456\nP0301 Misfire detected\nC0561");
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
});

describe("chooseInspectionForScan", () => {
  it("files a report onto the open inspection with the same VIN", () => {
    const other = { ...open, inspectionId: "insp-2", workOrderId: "wo-2", vin: "JH2SC5912KK123456" };
    const chosen = chooseInspectionForScan(
      { vin: "1HD1BJY174Y023456" },
      [open, other]
    );
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
    expect(
      chooseInspectionForScan({ vin: "JH2SC5912KK123456" }, [open])
    ).toBeNull();
  });
});

describe("scanAddressAllowed", () => {
  it("refuses the mailbox that sends customer email", () => {
    expect(scanAddressAllowed("Info@TorontoMoto.com", "info@torontomoto.com")).toBe(false);
  });

  it("accepts a separate scans mailbox", () => {
    expect(scanAddressAllowed("scans@torontomoto.com", "info@torontomoto.com")).toBe(true);
    expect(scanAddressAllowed("scans@torontomoto.com", null)).toBe(true);
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

describe("filingsForUnreadMail", () => {
  it("skips a message that was already filed and files the new one", () => {
    const filings = filingsForUnreadMail({
      messages: [
        { id: "old", text: "P0301 Misfire" },
        { id: "new", text: "VIN 1HD1BJY174Y023456\nNo fault codes" },
      ],
      waiting: [open],
      alreadyFiledIds: ["old"],
    });

    expect(filings).toHaveLength(1);
    expect(filings[0]).toMatchObject({
      gmailMessageId: "new",
      outcome: "no_codes",
      workOrderId: "wo-1",
      inspectionId: "insp-1",
    });
  });
});
