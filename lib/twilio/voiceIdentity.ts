const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Twilio Client identities allow alphanumeric + underscore only (max 121). */
export function encodeVoiceIdentity(userId: string): string {
  const compact = userId.replace(/-/g, "").toLowerCase();
  return `user_${compact}`;
}

export function decodeVoiceIdentity(identity: string | null | undefined): string | null {
  if (!identity) return null;
  const raw = identity.startsWith("client:")
    ? identity.slice("client:".length)
    : identity;
  const match = /^user_([0-9a-f]{32})$/i.exec(raw);
  if (!match) return null;
  const hex = match[1].toLowerCase();
  const uuid = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  return UUID_RE.test(uuid) ? uuid : null;
}
