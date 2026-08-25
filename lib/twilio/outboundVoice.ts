import type { UserRole } from "@/lib/database/types";
import { canUseMessenger, canUseShopPhone } from "@/lib/permissions/checks";

export function authorizeOutboundVoice(args: {
  role: UserRole;
  channel: "pstn" | "staff";
}): { ok: true } | { ok: false; error: "FORBIDDEN" } {
  if (args.channel === "pstn") {
    return canUseShopPhone(args.role) ? { ok: true } : { ok: false, error: "FORBIDDEN" };
  }
  return canUseMessenger(args.role) ? { ok: true } : { ok: false, error: "FORBIDDEN" };
}
