import { describe, expect, it } from "vitest";
import { selectInboundRingTargets } from "@/lib/twilio/inboundRing";
import type { InboundRingCandidate } from "@/lib/twilio/inboundRing";

const NOW = new Date("2026-08-25T12:00:00.000Z");
const FRESH = "2026-08-25T11:59:30.000Z";
const STALE = "2026-08-25T11:58:00.000Z";
const SHOP = "loc-east";
const WEST = "loc-west";

function candidate(overrides: Partial<InboundRingCandidate>): InboundRingCandidate {
  return {
    userId: "user-1",
    role: "service_advisor",
    membershipLocationIds: [SHOP],
    activeLocationId: SHOP,
    presenceLocationId: SHOP,
    presenceUpdatedAt: FRESH,
    ...overrides,
  };
}

describe("selectInboundRingTargets", () => {
  it("rings front-office staff whose active location matches the called shop", () => {
    const ids = selectInboundRingTargets({
      calledLocationId: SHOP,
      now: NOW,
      candidates: [
        candidate({ userId: "advisor" }),
        candidate({
          userId: "west-advisor",
          activeLocationId: WEST,
          presenceLocationId: WEST,
          membershipLocationIds: [WEST, SHOP],
        }),
      ],
    });
    expect(ids).toEqual(["advisor"]);
  });

  it("does not ring technicians even when present at the shop", () => {
    const ids = selectInboundRingTargets({
      calledLocationId: SHOP,
      now: NOW,
      candidates: [candidate({ userId: "tech", role: "technician" })],
    });
    expect(ids).toEqual([]);
  });

  it("requires membership, matching presence, and a fresh heartbeat", () => {
    const ids = selectInboundRingTargets({
      calledLocationId: SHOP,
      now: NOW,
      candidates: [
        candidate({ userId: "no-membership", membershipLocationIds: [WEST] }),
        candidate({ userId: "stale", presenceUpdatedAt: STALE }),
        candidate({ userId: "wrong-presence", presenceLocationId: WEST }),
        candidate({ userId: "ok" }),
      ],
    });
    expect(ids).toEqual(["ok"]);
  });
});
