import twilio from "twilio";
import { getTwilioVoiceConfig } from "@/lib/twilio/voiceConfig";
import { encodeVoiceIdentity } from "@/lib/twilio/voiceIdentity";

export function createVoiceAccessToken(userId: string): {
  token: string;
  identity: string;
  ttl: number;
} {
  const { accountSid, apiKeySid, apiKeySecret, twimlAppSid } = getTwilioVoiceConfig();
  const identity = encodeVoiceIdentity(userId);
  const ttl = 60 * 60;
  const AccessToken = twilio.jwt.AccessToken;
  const token = new AccessToken(accountSid, apiKeySid, apiKeySecret, {
    identity,
    ttl,
  });
  token.addGrant(
    new AccessToken.VoiceGrant({
      outgoingApplicationSid: twimlAppSid,
      incomingAllow: true,
    })
  );
  return { token: token.toJwt(), identity, ttl };
}
