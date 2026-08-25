import { describe, expect, it } from "vitest";
import { selectInboundRingTargets } from "@/lib/twilio/inboundRing";
import type { UserRole } from "@/lib/database/types";

const TORONTO = "loc-toronto";
const OTTAWA = "loc-ottawa";

function staff(opts: {
  user_id: string;
  role: UserRole;
  membershipLocationIds: string[];
  activeLocationId: string | null;
}) {
  return opts;
}

describe("selectInboundRingTargets", () => {
  it("rings front-office staff at the called location who are registered there", () => {
    const ids = selectInboundRingTargets({
      calledLocationId: TORONTO,
      registeredUserIds: ["adv-1", "mgr-1", "tech-1"],
      staff: [
        staff({
          user_id: "adv-1",
          role: "service_advisor",
          membershipLocationIds: [TORONTO],
          activeLocationId: TORONTO,
        }),
        staff({
          user_id: "mgr-1",
          role: "manager",
          membershipLocationIds: [TORONTO, OTTAWA],
          activeLocationId: TORONTO,
        }),
        staff({
          user_id: "tech-1",
          role: "technician",
          membershipLocationIds: [TORONTO],
          activeLocationId: TORONTO,
        }),
      ],
    });
    expect(ids.sort()).toEqual(["adv-1", "mgr-1"]);
  });

  it("excludes front office whose active location is a different shop", () => {
    const ids = selectInboundRingTargets({
      calledLocationId: TORONTO,
      registeredUserIds: ["adv-ottawa"],
      staff: [
        staff({
          user_id: "adv-ottawa",
          role: "service_advisor",
          membershipLocationIds: [TORONTO, OTTAWA],
          activeLocationId: OTTAWA,
        }),
      ],
    });
    expect(ids).toEqual([]);
  });

  it("excludes staff who are not registered on the Voice Device", () => {
    const ids = selectInboundRingTargets({
      calledLocationId: TORONTO,
      registeredUserIds: [],
      staff: [
        staff({
          user_id: "owner-1",
          role: "owner",
          membershipLocationIds: [TORONTO],
          activeLocationId: TORONTO,
        }),
      ],
    });
    expect(ids).toEqual([]);
  });

  it("excludes admin even when registered at the called location", () => {
    const ids = selectInboundRingTargets({
      calledLocationId: TORONTO,
      registeredUserIds: ["admin-1"],
      staff: [
        staff({
          user_id: "admin-1",
          role: "admin",
          membershipLocationIds: [TORONTO],
          activeLocationId: TORONTO,
        }),
      ],
    });
    expect(ids).toEqual([]);
  });
});
