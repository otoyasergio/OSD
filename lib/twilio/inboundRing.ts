import type { UserRole } from "@/lib/database/types";
import { canUseShopPhone } from "@/lib/permissions/checks";
import { isPresenceFresh } from "@/lib/twilio/presenceFresh";

export type InboundRingCandidate = {
  userId: string;
  role: UserRole;
  membershipLocationIds: string[];
  activeLocationId: string | null;
  presenceLocationId: string | null;
  presenceUpdatedAt: string | null;
};

export function selectInboundRingTargets(args: {
  calledLocationId: string;
  candidates: InboundRingCandidate[];
  now?: Date;
}): string[] {
  const now = args.now ?? new Date();
  return args.candidates
    .filter((candidate) => {
      if (!canUseShopPhone(candidate.role)) return false;
      if (!candidate.membershipLocationIds.includes(args.calledLocationId)) return false;
      if (candidate.activeLocationId !== args.calledLocationId) return false;
      if (candidate.presenceLocationId !== args.calledLocationId) return false;
      return isPresenceFresh(candidate.presenceUpdatedAt, now);
    })
    .map((candidate) => candidate.userId);
}
