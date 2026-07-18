import { redirect } from "next/navigation";
import { getCurrentAppUser } from "@/lib/auth/session";
import {
  canAssignTechnician,
  canClockStaff,
  canViewDashboard,
  staffHomePath,
} from "@/lib/permissions";
import {
  filterControlCenterCohort,
  flattenControlCenterBikes,
  parseControlCenterCohort,
} from "@/lib/control-center/cohorts";
import {
  getControlCenterData,
  listControlCenterCompletedToday,
} from "@/lib/services/controlCenter";
import {
  listReadyForPickup,
  listReadyForQc,
  listReadyForSafetyInspection,
  listRecentlyCompleted,
  listWaitingForParts,
} from "@/lib/services/readyForPickup";
import { ControlCenterCohortView } from "@/components/control-center/ControlCenterCohortView";
import { ControlCenterShell } from "@/components/control-center/ControlCenterShell";

export const dynamic = "force-dynamic";

export default async function ControlCenterPage({
  searchParams,
}: {
  searchParams: Promise<{ cohort?: string }>;
}) {
  const user = await getCurrentAppUser();
  if (!user) redirect("/login");
  if (!canViewDashboard(user.role)) redirect(staffHomePath(user.role));

  const params = await searchParams;
  const cohort = parseControlCenterCohort(params.cohort);

  if (cohort) {
    if (cohort === "completed_today") {
      const bikes = await listControlCenterCompletedToday().catch(() => []);
      return <ControlCenterCohortView cohort={cohort} bikes={bikes} />;
    }

    const data = await getControlCenterData();
    const bikes = filterControlCenterCohort(flattenControlCenterBikes(data), cohort);
    return <ControlCenterCohortView cohort={cohort} bikes={bikes} />;
  }

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
