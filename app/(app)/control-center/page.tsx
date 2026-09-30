import { redirect } from "next/navigation";
import { getRolePreviewContext } from "@/lib/auth/role-preview";
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
  const preview = await getRolePreviewContext();
  if (!preview) redirect("/login");
  const { role: viewRole } = preview;
  if (!canViewDashboard(viewRole)) redirect(staffHomePath(viewRole));

  const params = await searchParams;
  const cohort = parseControlCenterCohort(params.cohort);

  if (cohort) {
    if (cohort === "completed_today") {
      const bikes = await listControlCenterCompletedToday().catch(() => []);
      return <ControlCenterCohortView cohort={cohort} bikes={bikes} />;
    }

    const data = await getControlCenterData({ presentationRole: viewRole });
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
    getControlCenterData({ presentationRole: viewRole }),
    listWaitingForParts().catch(() => []),
    listReadyForQc().catch(() => []),
    listReadyForSafetyInspection().catch(() => []),
    listReadyForPickup().catch(() => []),
    listRecentlyCompleted().catch(() => []),
  ]);

  return (
    <ControlCenterShell
      data={data}
      canAssign={canAssignTechnician(viewRole)}
      canClockStaff={canClockStaff(viewRole)}
      waitingForParts={waitingForParts}
      readyForQc={readyForQc}
      readyForSafety={readyForSafety}
      readyForPickup={readyForPickup}
      recentlyCompleted={recentlyCompleted}
    />
  );
}
