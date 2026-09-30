import { redirect } from "next/navigation";
import { getCurrentAppUser } from "@/lib/auth/session";
import { getRolePreviewContext } from "@/lib/auth/role-preview";
import {
  getClockWidgetState,
  getMyShiftMonth,
  getMyTimesheetWeek,
} from "@/lib/services/timeClock";
import { shopDateKey } from "@/lib/datetime/format";
import { PageHeader } from "@/components/ui/PageHeader";
import { TimeClockWidget } from "@/components/technician/TimeClockWidget";
import { ShiftMonthCalendar } from "@/components/technician/ShiftMonthCalendar";
import { MyTimesheetCard } from "@/components/technician/MyTimesheetCard";
import { canSelfClock, staffHomePath } from "@/lib/permissions";

export const dynamic = "force-dynamic";

export default async function TechnicianClockPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const user = await getCurrentAppUser();
  if (!user) redirect("/login");
  const preview = await getRolePreviewContext();
  const viewRole = preview?.role ?? user.role;
  if (!canSelfClock(viewRole)) redirect(staffHomePath(viewRole));

  const params = await searchParams;
  const month = params.month?.trim() || "";
  const currentMonthKey = shopDateKey(new Date()).slice(0, 7);

  const [clockState, shiftMonth, myWeek] = await Promise.all([
    getClockWidgetState(user.user_id),
    getMyShiftMonth(month || null),
    getMyTimesheetWeek(null),
  ]);

  return (
    <div className="page-stack page-stack--narrow">
      <PageHeader
        title="Time clock"
        subtitle="Clock in and out for your shift, take meal breaks, and submit your week."
      />
      <TimeClockWidget
        openEntry={clockState.openEntry}
        openBreak={clockState.openBreak}
        mealBreakNudge={clockState.mealBreakNudge}
      />
      <MyTimesheetCard view={myWeek} />
      <ShiftMonthCalendar
        calendar={shiftMonth.calendar}
        entries={shiftMonth.entries}
        currentMonthKey={currentMonthKey}
      />
    </div>
  );
}
