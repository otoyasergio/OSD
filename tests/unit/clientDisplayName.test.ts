import { describe, expect, it } from "vitest";
import { clientDisplayName } from "@/lib/customers/displayName";

describe("clientDisplayName", () => {
  it("joins a client's first and last name", () => {
    expect(clientDisplayName({ first_name: "Ada", last_name: "Lovelace" })).toBe(
      "Ada Lovelace"
    );
  });

  it("reads a nested customer row returned as a one-item list", () => {
    expect(clientDisplayName([{ first_name: "Grace", last_name: "Hopper" }])).toBe(
      "Grace Hopper"
    );
  });

  it("returns null when the client is missing", () => {
    expect(clientDisplayName(null)).toBeNull();
    expect(clientDisplayName(undefined)).toBeNull();
    expect(clientDisplayName({ first_name: "  ", last_name: "" })).toBeNull();
  });
});
