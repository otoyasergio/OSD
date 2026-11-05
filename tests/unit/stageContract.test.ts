import { describe, expect, it } from "vitest";
import { advisorQueueKinds, stageContractFor } from "@/lib/accountability/stageContract";

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

  it("keeps an unsigned inspection with the technician until an estimate or maximum exists", () => {
    const unsigned = stageContractFor({
      ...base,
      status: "inspection_in_progress",
      inspectionSigned: false,
    });
    expect(unsigned.stage).toBe("inspection");
    expect(unsigned.responsibleRole).toBe("technician");
    expect(unsigned.responsibleName).toBe("Taylor Tech");
    expect(unsigned.evidenceMissing).toBe("Signed arrival inspection");
    expect(unsigned.nextAction).toBe(
      "Present an estimate or record a maximum authorization"
    );
    expect(unsigned.deadline).toBe(base.now);
    expect(unsigned.escalationName).toBe("Avery Advisor");

    const signed = stageContractFor({
      ...base,
      status: "inspection_in_progress",
      inspectionSigned: true,
    });
    expect(signed.evidenceMissing).toBeNull();
  });

  it("blocks chargeable work until the approval has an estimate or a written maximum", () => {
    const waiting = stageContractFor({
      ...base,
      status: "waiting_for_customer_approval",
    });
    expect(waiting.evidenceMissing).toBe(
      "Presented estimate version or a written maximum"
    );
    expect(waiting.nextAction).toBe(
      "Follow up on the promise date. Chargeable work stays blocked"
    );

    const confirmed = stageContractFor({
      ...base,
      status: "waiting_for_customer_approval",
      hasConfirmedEstimate: true,
    });
    expect(confirmed.evidenceMissing).toBeNull();

    const maximumWithoutAdvisor = stageContractFor({
      ...base,
      status: "waiting_for_customer_approval",
      advisorName: null,
      hasMaximumAuthorization: true,
    });
    expect(maximumWithoutAdvisor.evidenceMissing).toBe("No advisor of record");
  });

  it("names idle authorized work and a missing agreement separately", () => {
    const fresh = stageContractFor({
      ...base,
      status: "in_progress",
      hasConfirmedEstimate: true,
      lastJobActivityAt: "2026-11-01T12:00:00.000Z",
    });
    expect(fresh.evidenceMissing).toBeNull();
    expect(fresh.nextAction).toBe("Complete the authorized jobs");

    const idle = stageContractFor({
      ...base,
      status: "in_progress",
      hasMaximumAuthorization: true,
      lastJobActivityAt: "2026-10-29T15:00:00.000Z",
    });
    expect(idle.evidenceMissing).toBe("No job activity for three days");
    expect(idle.deadline).toBe("2026-11-01T15:00:00.000Z");

    const justInside = stageContractFor({
      ...base,
      status: "in_progress",
      hasConfirmedEstimate: true,
      lastJobActivityAt: "2026-10-29T15:00:00.001Z",
    });
    expect(justInside.evidenceMissing).toBeNull();

    const unauthorized = stageContractFor({
      ...base,
      status: "in_progress",
      lastJobActivityAt: null,
    });
    expect(unauthorized.evidenceMissing).toBe(
      "Confirmed estimate version or authorized maximum"
    );
  });

  it("sends a recorded final check to safety only when safety is required", () => {
    const toSafety = stageContractFor({
      ...base,
      status: "quality_check",
      safetyRequired: true,
    });
    expect(toSafety.evidenceMissing).toBe("Final-check record");
    expect(toSafety.nextAction).toBe("Send the bike to safety");

    const toPickup = stageContractFor({
      ...base,
      status: "quality_check",
      finalCheckRecorded: true,
      safetyRequired: false,
    });
    expect(toPickup.evidenceMissing).toBeNull();
    expect(toPickup.nextAction).toBe("Send the bike to pickup");
  });

  it("keeps safety with the head tech until that check is recorded", () => {
    const open = stageContractFor({ ...base, status: "safety_check" });
    expect(open.responsibleRole).toBe("head_tech");
    expect(open.responsibleName).toBeNull();
    expect(open.evidenceMissing).toBe("Head-tech safety check");
    expect(open.escalationName).toBe("Owen Owner");

    const passed = stageContractFor({
      ...base,
      status: "safety_check",
      safetyChecked: true,
    });
    expect(passed.evidenceMissing).toBeNull();
  });

  it("keeps storage and insurance parked, and tells a hold how to resume", () => {
    const storage = stageContractFor({ ...base, status: "in_storage" });
    expect(storage.nextAction).toBe("Book retrieval when the customer wants the bike");
    expect(storage.deadline).toBeNull();
    expect(storage.evidenceMissing).toBeNull();

    const insurance = stageContractFor({ ...base, status: "insurance" });
    expect(insurance.nextAction).toBe("Work the bike only on an authorized supplement");

    const hold = stageContractFor({ ...base, status: "on_hold" });
    expect(hold.nextAction).toBe("Resume when the hold reason is cleared");

    const done = stageContractFor({ ...base, status: "completed" });
    expect(done.nextAction).toBe("None");
    expect(done.evidenceMissing).toBeNull();
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

  it("drops the queue for a closed visit even when older signals are still present", () => {
    expect(
      advisorQueueKinds({
        status: "completed",
        lastInboundAt: "2026-11-01T14:00:00.000Z",
        lastOutboundAt: null,
        partsExpectedAt: "2026-10-30T15:00:00.000Z",
        partsShort: true,
        estimatedCompletion: "2026-10-31T20:00:00.000Z",
        readyForPickupAt: "2026-11-01T13:00:00.000Z",
        hasPresentedUnconfirmedEstimate: true,
        now: "2026-11-01T15:00:00.000Z",
      })
    ).toEqual([]);
  });

  it("does not call a parked bike a missed promise", () => {
    for (const status of ["in_storage", "insurance"] as const) {
      expect(
        advisorQueueKinds({
          status,
          lastInboundAt: null,
          lastOutboundAt: null,
          partsExpectedAt: null,
          partsShort: false,
          estimatedCompletion: "2026-10-31T20:00:00.000Z",
          readyForPickupAt: null,
          hasPresentedUnconfirmedEstimate: false,
          now: "2026-11-01T15:00:00.000Z",
        })
      ).toEqual([]);
    }
  });

  it("queues an unconfirmed estimate that is still sitting on an in-progress visit", () => {
    expect(
      advisorQueueKinds({
        status: "in_progress",
        lastInboundAt: null,
        lastOutboundAt: "2026-11-01T14:00:00.000Z",
        partsExpectedAt: "2026-11-03T15:00:00.000Z",
        partsShort: true,
        estimatedCompletion: "2026-11-05T20:00:00.000Z",
        readyForPickupAt: null,
        hasPresentedUnconfirmedEstimate: true,
        now: "2026-11-01T15:00:00.000Z",
      })
    ).toEqual(["pending_approval"]);
  });

  it("asks for an update once an approval has been quiet for two days", () => {
    const quiet = advisorQueueKinds({
      status: "waiting_for_customer_approval",
      lastInboundAt: null,
      lastOutboundAt: "2026-10-30T15:00:00.000Z",
      partsExpectedAt: null,
      partsShort: false,
      estimatedCompletion: "2026-11-05T20:00:00.000Z",
      readyForPickupAt: null,
      hasPresentedUnconfirmedEstimate: false,
      now: "2026-11-01T15:00:00.000Z",
    });
    const recent = advisorQueueKinds({
      status: "waiting_for_customer_approval",
      lastInboundAt: null,
      lastOutboundAt: "2026-10-30T15:00:00.001Z",
      partsExpectedAt: null,
      partsShort: false,
      estimatedCompletion: "2026-11-05T20:00:00.000Z",
      readyForPickupAt: null,
      hasPresentedUnconfirmedEstimate: false,
      now: "2026-11-01T15:00:00.000Z",
    });
    expect(quiet).toEqual(["pending_approval", "customer_update"]);
    expect(recent).toEqual(["pending_approval"]);
  });
});
