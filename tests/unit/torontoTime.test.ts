import { describe, expect, it } from "vitest";
import {
  torontoDatetimeLocal,
  torontoWallClockToIso,
} from "@/lib/accountability/torontoTime";

describe("toronto shop clock", () => {
  it("stores a winter afternoon as UTC five hours later", () => {
    expect(torontoWallClockToIso("2026-11-02T15:00")).toBe("2026-11-02T20:00:00.000Z");
  });

  it("stores a summer afternoon as UTC four hours later", () => {
    expect(torontoWallClockToIso("2026-07-15T15:00")).toBe("2026-07-15T19:00:00.000Z");
  });

  it("rejects a clock time that is not a complete local value", () => {
    expect(torontoWallClockToIso("")).toBeNull();
    expect(torontoWallClockToIso("2026-11-02")).toBeNull();
  });

  it("renders a stored instant as the Toronto clock the shop entered", () => {
    expect(torontoDatetimeLocal("2026-11-02T20:00:00.000Z")).toBe("2026-11-02T15:00");
  });
});
