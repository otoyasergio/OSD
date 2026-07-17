import { redirect } from "next/navigation";
import { getCurrentAppUser } from "@/lib/auth/session";
import {
  canAssignTechnician,
  canClockStaff,
  canViewDashboard,
  staffHomePath,
} from "@/lib/permissions";
import { getControlCenterData } from "@/lib/services/controlCenter";
import {
  listReadyForPickup,
  listReadyForQc,
  listReadyForSafetyInspection,
  listRecentlyCompleted,
  listWaitingForParts,
} from "@/lib/services/readyForPickup";
import { ControlCenterShell } from "@/components/control-center/ControlCenterShell";

export const dynamic = "force-dynamic";

export default async function ControlCenterPage() {
  const user = await getCurrentAppUser();
  if (!user) redirect("/login");
  if (!canViewDashboard(user.role)) redirect(staffHomePath(user.role));

  const [
    data,
    waitingForParts,
    readyForQc,
    readyForSafety,
    readyForPickup,
    recentlyCompleted,
  ] = await Promise.all([
    getControlCenterData(),
    listWaitingForParts().catch(() => []),
    listReadyForQc().catch(() => []),
    listReadyForSafetyInspection().catch(() => []),
    listReadyForPickup().catch(() => []),
    listRecentlyCompleted().catch(() => []),
  ]);

  return (
    <ControlCenterShell
      data={data}
      canAssign={canAssignTechnician(user.role)}
      canClockStaff={canClockStaff(user.role)}
      waitingForParts={waitingForParts}
      readyForQc={readyForQc}
      readyForSafety={readyForSafety}
      readyForPickup={readyForPickup}
      recentlyCompleted={recentlyCompleted}
    />
  );
}
