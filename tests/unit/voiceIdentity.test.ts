import { describe, expect, it } from "vitest";
import { decodeVoiceIdentity, encodeVoiceIdentity } from "@/lib/twilio/voiceIdentity";

const USER_ID = "550e8400-e29b-41d4-a716-446655440000";

describe("Twilio Voice client identity", () => {
  it("encodes an app_user id as alphanumeric plus underscore only", () => {
    const identity = encodeVoiceIdentity(USER_ID);
    expect(identity).toBe("user_550e8400e29b41d4a716446655440000");
    expect(identity).toMatch(/^[A-Za-z0-9_]+$/);
    expect(identity.length).toBeLessThanOrEqual(121);
    expect(identity).not.toContain("-");
  });

  it("round-trips the app_user uuid", () => {
    expect(decodeVoiceIdentity(encodeVoiceIdentity(USER_ID))).toBe(USER_ID);
  });

  it("accepts a client: prefix from Twilio From fields", () => {
    expect(decodeVoiceIdentity(`client:${encodeVoiceIdentity(USER_ID)}`)).toBe(USER_ID);
  });

  it("returns null for identities that are not app_user encodings", () => {
    expect(decodeVoiceIdentity("auth_abc")).toBeNull();
    expect(decodeVoiceIdentity(USER_ID)).toBeNull();
    expect(decodeVoiceIdentity("")).toBeNull();
  });
});
