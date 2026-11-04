import { describe, expect, it } from "vitest";
import { squareExternalPaymentBody } from "@/lib/square/client";
import { parseAamvaLicence } from "@/lib/id/aamva";
import { validateVinForModelYear } from "@/lib/vin/validate";
import { evaluateInvoiceGates } from "@/lib/wix/invoiceGates";
import { buildDraftInvoiceBody, WIX_INVOICES_APP_ID } from "@/lib/wix/invoicePayload";
import {
  ACKNOWLEDGED_INTAKE_SUCCESS,
  acknowledgementClearedOnSuccess,
  acknowledgementFieldsOnFailedRetry,
  assertIntakeInvoiceReady,
  bikeHeaderFields,
  canSyncCustomerBlock,
  draftNeedsNumberAllocation,
  allowsEnteredWixInvoiceNumber,
  intakeBannerMessage,
  intakeFailureMessage,
  isLegacyInvoicesApiUnavailable,
  LEGACY_INVOICES_API_REASON,
  normalizeEnteredWixInvoiceNumber,
  shouldLogWixInvoiceCreateFailure,
  shouldSkipWixInvoiceApi,
  shouldApplyInvoiceAcknowledgement,
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

describe("colour is optional", () => {
  it("lets intake continue when the motorcycle has no colour", () => {
    const ready = assertIntakeInvoiceReady({
      clientName: "Sergey Kurylo",
      phone: "4165550100",
      email: null,
      year: 2004,
      make: "HONDA",
      model: "CB650R",
      colour: "  ",
      plate: "N/A",
      vin: "1HD1KEM16DB609584",
    });
    expect(ready.ok).toBe(true);
    expect(
      bikeHeaderFields({
        vin: "1HD1KEM16DB609584",
        plate: "N/A",
        colour: "  ",
        mileage: "12000 km",
      }).map((field) => field.title)
    ).toEqual(["VIN", "Plate", "Mileage"]);
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

  it("sends the Wix Invoices app id with the work order reference", () => {
    const body = buildDraftInvoiceBody({
      contactId: "00000000-0000-4000-8000-000000000001",
      externalReferenceId: "11111111-1111-4111-8111-111111111111",
      issueDate: "2026-11-02T17:00:00.000Z",
      currency: "CAD",
      title: "2017 Triumph Bonneville T100",
      firstName: "Evan",
      lastName: "Kerr",
      lines: [{ name: "Oil change", price: 165 }],
      header: [],
    });
    const invoice = body.invoice as {
      sourceReference: { appId: string; externalReferenceId: string };
      reference: { standaloneReference: { limitActions: boolean } };
    };
    expect(invoice.sourceReference).toEqual({
      appId: WIX_INVOICES_APP_ID,
      externalReferenceId: "11111111-1111-4111-8111-111111111111",
    });
    expect(invoice.reference.standaloneReference.limitActions).toBe(false);
  });
});

describe("invoice number allocation", () => {
  it("publishes a draft that has no display number and leaves a numbered invoice alone", () => {
    expect(draftNeedsNumberAllocation({ status: "DRAFT", displayNumber: "" })).toBe(true);
    expect(draftNeedsNumberAllocation({ status: undefined, displayNumber: null })).toBe(true);
    expect(draftNeedsNumberAllocation({ status: "DRAFT", displayNumber: "0003895" })).toBe(false);
    expect(draftNeedsNumberAllocation({ status: "PUBLISHED", displayNumber: "" })).toBe(false);
    expect(canSyncCustomerBlock("DRAFT")).toBe(true);
    expect(canSyncCustomerBlock("PUBLISHED")).toBe(true);
    expect(canSyncCustomerBlock("PAID")).toBe(false);
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

  it("keeps an acknowledge success out of the form error", () => {
    expect(
      intakeBannerMessage({
        error: ACKNOWLEDGED_INTAKE_SUCCESS,
        notice: null,
      })
    ).toEqual({ error: null, notice: ACKNOWLEDGED_INTAKE_SUCCESS });
    expect(
      intakeBannerMessage({
        error: "Wix did not return an invoice number.",
        notice: null,
      }).error
    ).toBe("Wix did not return an invoice number.");
  });

  it("clears the previous acknowledge when a retry stores a new Wix error", () => {
    expect(acknowledgementFieldsOnFailedRetry({ holdRevision: 4 })).toEqual({
      acknowledged_at: null,
      hold_revision: 5,
    });
  });

  it("ignores an acknowledge for an error that a retry already replaced", () => {
    const seen = {
      storedErrorText: "legacy api",
      seenErrorText: "legacy api",
      cleared: false,
      alreadyAcknowledged: false,
    };
    expect(
      shouldApplyInvoiceAcknowledgement({ ...seen, storedRevision: 5, seenRevision: 5 })
    ).toBe(true);
    expect(
      shouldApplyInvoiceAcknowledgement({ ...seen, storedRevision: 6, seenRevision: 5 })
    ).toBe(false);
    expect(
      shouldApplyInvoiceAcknowledgement({
        ...seen,
        storedRevision: 5,
        seenRevision: 5,
        alreadyAcknowledged: true,
      })
    ).toBe(false);
    expect(
      shouldApplyInvoiceAcknowledgement({
        ...seen,
        storedRevision: 5,
        seenRevision: 5,
        seenErrorText: "older app id error",
      })
    ).toBe(false);
  });

  it("tells the counter to enter the Wix invoice number when the new API is unavailable", () => {
    const reason =
      "The new Invoices API isn't available on this site yet. The site still uses the legacy invoices service, which is only accessible through Velo. New Invoices, along with its API and SDK, is being rolled out gradually — no action is needed on your side.";
    expect(isLegacyInvoicesApiUnavailable(reason)).toBe(true);
    expect(allowsEnteredWixInvoiceNumber(reason)).toBe(true);
    const message = intakeFailureMessage({
      clientName: "Evan Kerr",
      bikeLabel: "2017 TRIUMPH Bonneville T100",
      wixReason: reason,
    });
    expect(message).toContain("enter that invoice number here");
    expect(isLegacyInvoicesApiUnavailable(message)).toBe(false);
    expect(allowsEnteredWixInvoiceNumber(message)).toBe(true);
    expect(message).toContain("Evan Kerr");
    expect(message).toContain("2017 TRIUMPH Bonneville T100");
    expect(message).not.toContain(ACKNOWLEDGED_INTAKE_SUCCESS);
    expect(message).toContain("No work order number was created.");
    expect(normalizeEnteredWixInvoiceNumber("0003894")).toBe("0003894");
    expect(normalizeEnteredWixInvoiceNumber(" 3894 ")).toBe("3894");
    expect(normalizeEnteredWixInvoiceNumber("WO-1042")).toBeNull();
    expect(normalizeEnteredWixInvoiceNumber("0")).toBeNull();
    expect(allowsEnteredWixInvoiceNumber("Wix did not return an invoice number.")).toBe(
      false
    );
    expect(isLegacyInvoicesApiUnavailable(LEGACY_INVOICES_API_REASON)).toBe(true);
    expect(shouldLogWixInvoiceCreateFailure(reason)).toBe(false);
    expect(shouldLogWixInvoiceCreateFailure(message)).toBe(true);
    expect(shouldLogWixInvoiceCreateFailure("Wix timed out.")).toBe(true);
    const now = Date.parse("2026-11-02T22:00:00.000Z");
    expect(
      shouldSkipWixInvoiceApi({
        latestLegacyRefusalAt: "2026-11-02T20:40:46.000Z",
        latestWixInvoiceAt: null,
        nowMs: now,
      })
    ).toBe(true);
    expect(
      shouldSkipWixInvoiceApi({
        latestLegacyRefusalAt: "2026-11-02T20:40:46.000Z",
        latestWixInvoiceAt: "2026-11-02T21:00:00.000Z",
        nowMs: now,
      })
    ).toBe(false);
    expect(
      shouldSkipWixInvoiceApi({
        latestLegacyRefusalAt: "2026-10-01T20:40:46.000Z",
        latestWixInvoiceAt: null,
        nowMs: now,
      })
    ).toBe(false);
    expect(
      shouldSkipWixInvoiceApi({
        latestLegacyRefusalAt: null,
        latestWixInvoiceAt: null,
        nowMs: now,
      })
    ).toBe(false);
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
