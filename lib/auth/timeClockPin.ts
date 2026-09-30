import { randomBytes, scryptSync, timingSafeEqual } from "crypto";

const KEYLEN = 64;

/** PIN must be exactly four digits. */
export function assertValidPin(pin: string): void {
  if (!/^\d{4}$/.test(pin)) {
    throw new Error("INVALID_PIN");
  }
}

/** Hash a 4-digit PIN with a random salt. Format: `salt:hash` (both hex). */
export function hashPin(pin: string): string {
  assertValidPin(pin);
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(pin, salt, KEYLEN).toString("hex");
  return `${salt}:${hash}`;
}

/** Constant-time verify of a PIN against a stored `salt:hash` value. */
export function verifyPin(pin: string, storedHash: string): boolean {
  if (!/^\d{4}$/.test(pin)) return false;
  const [salt, hashHex] = storedHash.split(":");
  if (!salt || !hashHex) return false;
  try {
    const computed = scryptSync(pin, salt, KEYLEN);
    const expected = Buffer.from(hashHex, "hex");
    if (computed.length !== expected.length) return false;
    return timingSafeEqual(computed, expected);
  } catch {
    return false;
  }
}
