import { describe, expect, it } from "vitest";
import {
  advisorQueueKinds,
  stageContractFor,
} from "@/lib/accountability/stageContract";

const base = {
  status: "open" as const,
  advisorName: "Avery Advisor",
  technicianName: "Taylor Tech",
  ownerName: "Owen Owner",
  intakePhotoCount: 6,
  inspectionSigned: false,
  hasConfirmedEstimate: false,
  hasMaximumAuthorization: false,
  partsShort: false,
  partsExpectedAt: null as string | null,
  lastJobActivityAt: "2026-11-01T12:00:00.000Z",
  finalCheckRecorded: false,
  safetyRequired: false,
  safetyChecked: false,
  checkoutComplete: false,
  estimatedCompletion: "2026-11-03T20:00:00.000Z",
  now: "2026-11-01T15:00:00.000Z",
};

describe("stageContractFor", () => {
  it("asks the advisor to assign a technician when intake photos exist and nobody is assigned", () => {
    const contract = stageContractFor({
      ...base,
      technicianName: null,
    });
    expect(contract.stage).toBe("intake");
    expect(contract.responsibleRole).toBe("advisor");
    expect(contract.responsibleName).toBe("Avery Advisor");
    expect(contract.evidenceMissing).toBeNull();
    expect(contract.nextAction).toBe("Assign a technician or record a promise date");
    expect(contract.escalationName).toBe("Owen Owner");
  });

  it("escalates intake to the owner when no advisor is set", () => {
    const contract = stageContractFor({ ...base, advisorName: null });
    expect(contract.evidenceMissing).toBe("No advisor of record");
    expect(contract.escalationName).toBe("Owen Owner");
    expect(contract.responsibleName).toBeNull();
  });

  it("keeps payment off the pickup stage and names checkout photos as the evidence", () => {
    const contract = stageContractFor({
      ...base,
      status: "ready_for_pickup",
      checkoutComplete: false,
    });
    expect(contract.stage).toBe("pickup");
    expect(contract.evidenceRequired).toBe("Checkout photos");
    expect(contract.evidenceMissing).toBe("Checkout photos");
    expect(contract.nextAction).toBe("Release the bike or move it to storage");
    expect(contract.nextAction).not.toMatch(/payment/i);
  });

  it("tells parts receiving to create an install task and not a customer-ready message", () => {
    const contract = stageContractFor({
      ...base,
      status: "waiting_for_parts",
      partsShort: true,
      partsExpectedAt: "2026-10-30T15:00:00.000Z",
    });
    expect(contract.nextAction).toBe(
      "Receive the short lines. Receiving creates an install task for the technician"
    );
    expect(contract.evidenceMissing).toMatch(/short/i);
  });
});

describe("advisorQueueKinds", () => {
  it("lists an unanswered inbound message, a missed promise, and overdue parts", () => {
    expect(
      advisorQueueKinds({
        status: "waiting_for_parts",
        lastInboundAt: "2026-11-01T14:00:00.000Z",
        lastOutboundAt: "2026-11-01T12:00:00.000Z",
        partsExpectedAt: "2026-10-30T15:00:00.000Z",
        partsShort: true,
        estimatedCompletion: "2026-10-31T20:00:00.000Z",
        readyForPickupAt: null,
        hasPresentedUnconfirmedEstimate: false,
        now: "2026-11-01T15:00:00.000Z",
      })
    ).toEqual(["unanswered_message", "overdue_parts", "missed_promise"]);
  });

  it("asks for a customer update when the bike is ready and no message has gone out since", () => {
    expect(
      advisorQueueKinds({
        status: "ready_for_pickup",
        lastInboundAt: null,
        lastOutboundAt: "2026-10-01T12:00:00.000Z",
        partsExpectedAt: null,
        partsShort: false,
        estimatedCompletion: "2026-11-05T20:00:00.000Z",
        readyForPickupAt: "2026-11-01T13:00:00.000Z",
        hasPresentedUnconfirmedEstimate: false,
        now: "2026-11-01T15:00:00.000Z",
      })
    ).toEqual(["customer_update"]);
  });
});
