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
  listInStorage,
  listInsuranceBikes,
  listReadyForPickup,
  listReadyForQc,
  listReadyForSafetyInspection,
  listRecentlyCompleted,
  listWaitingForApproval,
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
    waitingForApproval,
    waitingForParts,
    readyForQc,
    readyForSafety,
    readyForPickup,
    inStorage,
    recentlyCompleted,
    insuranceBikes,
  ] = await Promise.all([
    getControlCenterData({ presentationRole: viewRole }),
    listWaitingForApproval().catch(() => []),
    listWaitingForParts().catch(() => []),
    listReadyForQc().catch(() => []),
    listReadyForSafetyInspection().catch(() => []),
    listReadyForPickup({ includeCustomer: true }).catch(() => []),
    listInStorage().catch(() => []),
    listRecentlyCompleted().catch(() => []),
    listInsuranceBikes().catch(() => []),
  ]);

  return (
    <ControlCenterShell
      data={data}
      canAssign={canAssignTechnician(viewRole)}
      canClockStaff={canClockStaff(viewRole)}
      waitingForApproval={waitingForApproval}
      waitingForParts={waitingForParts}
      readyForQc={readyForQc}
      readyForSafety={readyForSafety}
      readyForPickup={readyForPickup}
      inStorage={inStorage}
      recentlyCompleted={recentlyCompleted}
      insuranceBikes={insuranceBikes}
    />
  );
}
