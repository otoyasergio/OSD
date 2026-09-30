import { describe, expect, it } from "vitest";
import { assertValidPin, hashPin, verifyPin } from "@/lib/auth/timeClockPin";

describe("timeClockPin", () => {
  it("accepts exactly 4 digits", () => {
    expect(() => assertValidPin("1234")).not.toThrow();
    expect(() => assertValidPin("0000")).not.toThrow();
  });

  it("rejects non-4-digit PINs", () => {
    expect(() => assertValidPin("123")).toThrow("INVALID_PIN");
    expect(() => assertValidPin("12345")).toThrow("INVALID_PIN");
    expect(() => assertValidPin("12a4")).toThrow("INVALID_PIN");
    expect(() => assertValidPin("")).toThrow("INVALID_PIN");
  });

  it("hashes and verifies a PIN", () => {
    const stored = hashPin("4821");
    expect(stored).toMatch(/^[0-9a-f]+:[0-9a-f]+$/);
    expect(verifyPin("4821", stored)).toBe(true);
    expect(verifyPin("4822", stored)).toBe(false);
    expect(verifyPin("482", stored)).toBe(false);
  });

  it("uses a unique salt per hash", () => {
    const a = hashPin("9999");
    const b = hashPin("9999");
    expect(a).not.toBe(b);
    expect(verifyPin("9999", a)).toBe(true);
    expect(verifyPin("9999", b)).toBe(true);
  });
});
