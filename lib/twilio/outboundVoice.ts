import type { UserRole } from "@/lib/database/types";
import { canUseMessenger, canUseShopPhone } from "@/lib/permissions/checks";

export type OutboundVoiceRequest =
  | { type: "pstn"; toE164: string | null; callerId: string | null }
  | { type: "staff"; identity: string };

export function authorizeOutboundVoice(
  role: UserRole,
  request: OutboundVoiceRequest
): { ok: true } | { ok: false; code: string } {
  if (request.type === "pstn") {
    if (!canUseShopPhone(role)) return { ok: false, code: "FORBIDDEN" };
    if (!request.callerId) return { ok: false, code: "SHOP_PHONE_NOT_CONFIGURED" };
    if (!request.toE164) return { ok: false, code: "INVALID_PHONE" };
    return { ok: true };
  }

  if (!canUseMessenger(role)) return { ok: false, code: "FORBIDDEN" };
  if (!request.identity) return { ok: false, code: "CALL_NOT_FOUND" };
  return { ok: true };
}
