import { describe, expect, it } from "vitest";
import { squareExternalPaymentBody } from "@/lib/square/client";
import { parseAamvaLicence } from "@/lib/id/aamva";
import { validateVinForModelYear } from "@/lib/vin/validate";
import { evaluateInvoiceGates } from "@/lib/wix/invoiceGates";
import { buildDraftInvoiceBody } from "@/lib/wix/invoicePayload";
import {
  acknowledgementClearedOnSuccess,
  bikeHeaderFields,
  formatPreviewDisplayNumber,
  invoiceNumbersEqual,
  isInvoiceIntegerQuery,
  isWixInvoiceId,
  shouldIgnoreIncomingRevision,
  squareDecision,
  squareIdempotencyKey,
  preTaxLineItems,
  recordedCentsForVisit,
  shopDueDateIso,
  squareRecordName,
  visitIsSquared,
  wixStatusLabel,
} from "@/lib/wix/invoiceRules";
import { wixInvoicesEnabled } from "@/lib/config/features";

describe("invoice number match", () => {
  it("treats leading zeros as the same invoice and rejects a shorter number", () => {
    expect(invoiceNumbersEqual("3894", "0003894")).toBe(true);
    expect(invoiceNumbersEqual("03894", "0003894")).toBe(true);
    expect(invoiceNumbersEqual("003894", "0003894")).toBe(true);
    expect(invoiceNumbersEqual("389", "0003894")).toBe(false);
    expect(invoiceNumbersEqual("38940", "0003894")).toBe(false);
    expect(isInvoiceIntegerQuery("0003894")).toBe(true);
    expect(isInvoiceIntegerQuery("WO-1042")).toBe(false);
    expect(isWixInvoiceId("11111111-1111-4111-8111-111111111111")).toBe(true);
    expect(isWixInvoiceId("../invoices/1")).toBe(false);
  });

  it("previews the next padded number without reserving it", () => {
    expect(formatPreviewDisplayNumber(3894, "0003894")).toBe("0003895");
  });
});

describe("intake VIN year rule", () => {
  it("requires 17 characters from 1991 and allows a shorter VIN in 1990", () => {
    expect(validateVinForModelYear("1HD1KEM16DB609584", 2004).ok).toBe(true);
    expect(validateVinForModelYear("1HD1KEM16", 2004).ok).toBe(false);
    expect(validateVinForModelYear("ABC123", 1990).ok).toBe(true);
    expect(validateVinForModelYear("1HD1KEM1XDB609584", 2013).ok).toBe(true);
  });
});

describe("HST is sent once", () => {
  it("drops an HST line and keeps pre-tax prices", () => {
    const sent = preTaxLineItems([
      { name: "Oil change", price: 100 },
      { name: "HST (13%)", price: 13 },
    ]);
    expect(sent).toEqual([{ name: "Oil change", price: 100, quantity: 1 }]);
    const body = buildDraftInvoiceBody({
      contactId: "00000000-0000-0000-0000-000000000001",
      issueDate: "2026-11-01T16:00:00.000Z",
      currency: "CAD",
      title: "2020 Honda CB500",
      firstName: "Ada",
      lastName: "Lovelace",
      lines: sent,
      header: bikeHeaderFields({
        vin: "JH2SC5900DM200001",
        plate: "N/A",
        colour: "Red",
        mileage: "12000 km",
      }),
      technicianName: "Pat",
    });
    const invoice = body.invoice as {
      lineItems: Array<{ customItem: { name: string } }>;
      customFields: { businessCustomFields: Array<{ title: string }> };
    };
    expect(invoice.lineItems.map((line) => line.customItem.name)).toEqual(["Oil change"]);
    expect(invoice.customFields.businessCustomFields[0]?.title).toBe("Technician");
  });
});

describe("revision, square, and acknowledgement", () => {
  it("ignores an event whose revision is already stored", () => {
    expect(shouldIgnoreIncomingRevision("4", "4")).toBe(true);
    expect(shouldIgnoreIncomingRevision("4", "3")).toBe(true);
    expect(shouldIgnoreIncomingRevision("4", "5")).toBe(false);
  });

  it("squares PayPal once and skips a void", () => {
    expect(squareDecision({
      method: "PayPal",
      voided: false,
      excludeFromSquare: false,
      alreadySquared: false,
    }).action).toBe("auto_square");
    expect(squareDecision({
      method: "CreditCard",
      voided: false,
      excludeFromSquare: false,
      alreadySquared: false,
    }).action).toBe("ask");
    expect(squareDecision({
      method: "PayPal",
      voided: true,
      excludeFromSquare: false,
      alreadySquared: false,
    }).action).toBe("skip_void");
    expect(squareDecision({
      method: "PayPal",
      voided: false,
      excludeFromSquare: false,
      alreadySquared: true,
    }).action).toBe("already_squared");
    expect(squareIdempotencyKey("pay-1")).toBe("pay-1");
    expect(squareRecordName("Ada Lovelace", "0003894")).toBe("Ada Lovelace 0003894");
  });

  it("uses an external Square payment and does not charge a card", () => {
    const body = squareExternalPaymentBody({
      idempotencyKey: "wix-payment-1",
      amountCents: 11300,
      currency: "CAD",
      recordName: "Ada Lovelace 0003894",
      locationId: "LOC",
    });
    expect(body.source_id).toBe("EXTERNAL");
    expect(body.amount_money).toEqual({ amount: 11300, currency: "CAD" });
    expect(body.idempotency_key).toBe("wix-payment-1");
  });

  it("keeps a chosen due date on the Toronto calendar day", () => {
    expect(shopDueDateIso("2026-11-02", "2026-01-01T16:00:00.000Z")).toBe(
      "2026-11-02T16:00:00.000Z"
    );
    expect(shopDueDateIso("2026-11-02T00:00:00.000Z", "2026-01-01T16:00:00.000Z")).toBe(
      "2026-11-02T16:00:00.000Z"
    );
  });

  it("uses the terminal amount when staff leave the offline amount blank", () => {
    expect(
      recordedCentsForVisit({ terminalAmountCents: 12500, offlineAmountCents: null })
    ).toBe(12500);
    expect(
      recordedCentsForVisit({ terminalAmountCents: null, offlineAmountCents: 4000 })
    ).toBe(4000);
    expect(() =>
      recordedCentsForVisit({ terminalAmountCents: null, offlineAmountCents: null })
    ).toThrow("SQUARE_AMOUNT_REQUIRED");
  });

  it("counts a voided visit against the amount staff recorded", () => {
    expect(visitIsSquared({
      voided: true,
      wixCollectedCents: 0,
      squareRecordedCents: 5000,
      staffRecordedCents: 5000,
    })).toBe(true);
    expect(visitIsSquared({
      voided: false,
      wixCollectedCents: 5000,
      squareRecordedCents: 5000,
      staffRecordedCents: 0,
    })).toBe(true);
  });

  it("clears the acknowledgement only after a successful retry", () => {
    expect(acknowledgementClearedOnSuccess({ retrySucceeded: true })).toBe(true);
    expect(acknowledgementClearedOnSuccess({ retrySucceeded: false })).toBe(false);
  });

  it("labels Overdue from Wix", () => {
    expect(wixStatusLabel("PUBLISHED", ["OVERDUE"])).toBe("Overdue");
  });
});

describe("gates and flag", () => {
  it("stays off unless both switches are 1", () => {
    expect(wixInvoicesEnabled({})).toBe(false);
    expect(wixInvoicesEnabled({ WIX_INVOICES_ENABLED: "1" })).toBe(false);
    expect(
      wixInvoicesEnabled({
        WIX_INVOICES_ENABLED: "1",
        WIX_INVOICES_GATES_CONFIRMED: "1",
      })
    ).toBe(true);
  });

  it("refuses the flag when the draft has no display number", () => {
    const decision = evaluateInvoiceGates({
      latestNumberStatus: 200,
      latestNumber: 3894,
      probeDraftStatus: 200,
      probeDisplayNumber: "",
      businessName: "OTOMOTO TORONTO MOTO INC.",
      ontarioHst: true,
      squareLocationOk: true,
      squareExternalPaymentReady: true,
    });
    expect(decision.ok).toBe(false);
    expect(decision.reasons.join(" ")).toMatch(/displayNumber/i);
  });
});

describe("Ontario licence barcode", () => {
  it("reads name, address, birth, expiry, and licence number", () => {
    const scan = parseAamvaLicence(
      [
        "@",
        "ANSI 636012",
        "DAQD1234-56789-01234",
        "DCSLOVELACE",
        "DACADA",
        "DAG99 RIVER STREET",
        "DAITORONTO",
        "DAJON",
        "DAKM5A 3P4",
        "DBB01011990",
        "DBA01012030",
      ].join("\n")
    );
    expect(scan).toMatchObject({
      firstName: "ADA",
      lastName: "LOVELACE",
      dateOfBirth: "1990-01-01",
      licenceExpiry: "2030-01-01",
      licenceNumber: "D1234-56789-01234",
    });
    expect(scan?.address).toContain("99 RIVER STREET");
  });
});
