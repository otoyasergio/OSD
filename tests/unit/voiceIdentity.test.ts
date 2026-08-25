import { describe, expect, it } from "vitest";
import { decodeVoiceIdentity, encodeVoiceIdentity } from "@/lib/twilio/voiceIdentity";

const USER_ID = "550e8400-e29b-41d4-a716-446655440000";

describe("encodeVoiceIdentity", () => {
  it("strips hyphens and prefixes user_ so Twilio Client accepts the identity", () => {
    expect(encodeVoiceIdentity(USER_ID)).toBe("user_550e8400e29b41d4a716446655440000");
  });
});

describe("decodeVoiceIdentity", () => {
  it("round-trips a valid encoded identity back to the UUID", () => {
    expect(decodeVoiceIdentity(encodeVoiceIdentity(USER_ID))).toBe(USER_ID);
  });

  it("returns null for identities that are not encoded user ids", () => {
    expect(decodeVoiceIdentity("client:alice")).toBeNull();
    expect(decodeVoiceIdentity(USER_ID)).toBeNull();
    expect(decodeVoiceIdentity("user_notauuid")).toBeNull();
  });
});
