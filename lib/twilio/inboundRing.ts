import type { UserRole } from "@/lib/database/types";
import { canUseShopPhone } from "@/lib/permissions/checks";

export type InboundRingStaff = {
  user_id: string;
  role: UserRole;
  membershipLocationIds: string[];
  activeLocationId: string | null;
};

export function selectInboundRingTargets(args: {
  calledLocationId: string;
  staff: InboundRingStaff[];
  registeredUserIds: string[];
}): string[] {
  const registered = new Set(args.registeredUserIds);
  return args.staff
    .filter(
      (person) =>
        canUseShopPhone(person.role) &&
        person.activeLocationId === args.calledLocationId &&
        person.membershipLocationIds.includes(args.calledLocationId) &&
        registered.has(person.user_id)
    )
    .map((person) => person.user_id);
}
