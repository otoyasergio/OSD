export type PassportShareStatus = "active" | "expired" | "revoked";

export function passportShareStatus(
  share: { expires_at: string; revoked_at: string | null },
  now = new Date()
): PassportShareStatus {
  if (share.revoked_at) return "revoked";
  if (new Date(share.expires_at).getTime() <= now.getTime()) return "expired";
  return "active";
}
