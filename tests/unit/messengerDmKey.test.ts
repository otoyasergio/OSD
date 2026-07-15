import { describe, expect, it } from "vitest";
import { buildDmKey } from "@/lib/messenger/dmKey";
import { sortDirectory } from "@/lib/messenger/directorySort";

describe("buildDmKey", () => {
  it("is order-independent", () => {
    expect(buildDmKey("a", "b")).toBe(buildDmKey("b", "a"));
  });
});

describe("sortDirectory", () => {
  it("puts active-location staff first, alphabetically, then everyone else", () => {
    const staff = [
      {
        user_id: "1",
        first_name: "Zoe",
        last_name: "Zephyr",
        location_ids: ["loc-2"],
      },
      {
        user_id: "2",
        first_name: "Amy",
        last_name: "Adams",
        location_ids: ["loc-1"],
      },
      {
        user_id: "3",
        first_name: "Bob",
        last_name: "Baker",
        location_ids: ["loc-1"],
      },
    ];
    const sorted = sortDirectory(staff, "loc-1");
    expect(sorted.map((s) => s.user_id)).toEqual(["2", "3", "1"]);
  });
});
