const UUID_HEX = /^[0-9a-f]{32}$/;
const ENCODED = /^user_([0-9a-f]{32})$/;

export function encodeVoiceIdentity(userId: string): string {
  const hex = userId.trim().toLowerCase().replace(/-/g, "");
  if (!UUID_HEX.test(hex)) {
    throw new Error("INVALID_USER_ID");
  }
  return `user_${hex}`;
}

export function decodeVoiceIdentity(identity: string): string | null {
  const match = ENCODED.exec(identity.trim().toLowerCase());
  if (!match) return null;
  const hex = match[1];
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
