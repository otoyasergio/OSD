import twilio from "twilio";

function getVideoConfig() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID?.trim() ?? "";
  const apiKeySid = process.env.TWILIO_API_KEY_SID?.trim() ?? "";
  const apiKeySecret = process.env.TWILIO_API_KEY_SECRET?.trim() ?? "";
  if (!accountSid || !apiKeySid || !apiKeySecret) {
    throw new Error("TWILIO_VIDEO_NOT_CONFIGURED");
  }
  return { accountSid, apiKeySid, apiKeySecret };
}

export function isTwilioVideoConfigured(): boolean {
  return Boolean(
    process.env.TWILIO_ACCOUNT_SID?.trim() &&
    process.env.TWILIO_API_KEY_SID?.trim() &&
    process.env.TWILIO_API_KEY_SECRET?.trim()
  );
}

export function createVideoAccessToken(identity: string, roomName: string): string {
  const { accountSid, apiKeySid, apiKeySecret } = getVideoConfig();
  const AccessToken = twilio.jwt.AccessToken;
  const token = new AccessToken(accountSid, apiKeySid, apiKeySecret, {
    identity,
    ttl: 60 * 60,
  });
  token.addGrant(new AccessToken.VideoGrant({ room: roomName }));
  return token.toJwt();
}

export async function ensureVideoRoom(roomName: string): Promise<{ sid: string }> {
  const { accountSid, apiKeySid, apiKeySecret } = getVideoConfig();
  const client = twilio(apiKeySid, apiKeySecret, { accountSid });
  try {
    const room = await client.video.v1.rooms.create({
      uniqueName: roomName,
      type: "group",
    });
    return { sid: room.sid };
  } catch (err) {
    // 53113: room with this unique name already exists — fetch instead.
    if ((err as { code?: number })?.code === 53113) {
      const room = await client.video.v1.rooms(roomName).fetch();
      return { sid: room.sid };
    }
    throw err;
  }
}
