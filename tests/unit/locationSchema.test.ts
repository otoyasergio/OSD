import { describe, expect, it } from "vitest";
import { locationSchema } from "@/lib/validation/schemas";

describe("locationSchema shop rate", () => {
  it("accepts a positive hourly shop rate", () => {
    expect(
      locationSchema.parse({
        name: "Toronto",
        code: "TOR",
        status: "active",
        hourly_rate: "156",
      }).hourly_rate
    ).toBe(156);
  });

  it("rejects zero and negative shop rates", () => {
    expect(() =>
      locationSchema.parse({
        name: "Toronto",
        code: "TOR",
        status: "active",
        hourly_rate: "0",
      })
    ).toThrow();
    expect(() =>
      locationSchema.parse({
        name: "Toronto",
        code: "TOR",
        status: "active",
        hourly_rate: "-1",
      })
    ).toThrow();
  });
});

describe("locationSchema shop phone", () => {
  it("accepts a blank shop phone as null", () => {
    const parsed = locationSchema.parse({
      name: "East",
      code: "EAST",
      status: "active",
      voice_e164: "",
    });
    expect(parsed.voice_e164).toBeNull();
  });

  it("accepts E.164 and rejects a local number", () => {
    expect(
      locationSchema.parse({
        name: "East",
        code: "EAST",
        status: "active",
        voice_e164: "+14165551212",
      }).voice_e164
    ).toBe("+14165551212");
    expect(() =>
      locationSchema.parse({
        name: "East",
        code: "EAST",
        status: "active",
        voice_e164: "4165551212",
      })
    ).toThrow();
  });
});
