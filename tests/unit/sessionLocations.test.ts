import { describe, expect, it } from "vitest";
import { activeLocationIdsFromMemberships } from "@/lib/auth/session";

describe("activeLocationIdsFromMemberships", () => {
  it("keeps only memberships whose location is active", () => {
    expect(
      activeLocationIdsFromMemberships([
        { location_id: "tor", location: { status: "active" } },
        { location_id: "ott", location: { status: "inactive" } },
        { location_id: "nested", location: [{ status: "active" }] },
      ])
    ).toEqual(["tor", "nested"]);
  });

  it("returns empty when there are no memberships", () => {
    expect(activeLocationIdsFromMemberships(null)).toEqual([]);
    expect(activeLocationIdsFromMemberships(undefined)).toEqual([]);
  });
});
