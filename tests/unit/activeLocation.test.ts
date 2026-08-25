import { describe, expect, it } from "vitest";
import {
  resolveActiveLocationId,
  sortMembershipLocationIds,
} from "@/lib/auth/activeLocation";

const TOR = "b2209ad8-ecfb-46e1-8797-1e8a2502aae5";
const OTT = "8bd5cba4-2334-4ea0-9cbe-b4ef12b974a3";

describe("sortMembershipLocationIds", () => {
  it("puts the oldest shop first so a new tech defaults to Toronto, not Ottawa", () => {
    expect(
      sortMembershipLocationIds([
        { location_id: OTT, created_at: "2026-07-12 02:50:34.61079+00" },
        { location_id: TOR, created_at: "2026-07-09 03:59:04.696907+00" },
      ])
    ).toEqual([TOR, OTT]);
  });
});

describe("resolveActiveLocationId", () => {
  it("uses the cookie when it is one of the member shops", () => {
    expect(resolveActiveLocationId([TOR, OTT], OTT)).toBe(OTT);
  });

  it("falls back to the first membership when the cookie is missing or foreign", () => {
    expect(resolveActiveLocationId([TOR, OTT], null)).toBe(TOR);
    expect(resolveActiveLocationId([TOR, OTT], "not-a-member")).toBe(TOR);
  });
});
