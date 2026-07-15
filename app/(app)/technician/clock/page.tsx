import { redirect } from "next/navigation";
import { getCurrentAppUser } from "@/lib/auth/session";
import { isFloorTech, staffHomePath } from "@/lib/permissions";
import { getMyShiftMonth, getOpenTimeClockEntry } from "@/lib/services/timeClock";
import { shopDateKey } from "@/lib/datetime/format";
import { PageHeader } from "@/components/ui/PageHeader";
import { TimeClockWidget } from "@/components/technician/TimeClockWidget";
import { ShiftMonthCalendar } from "@/components/technician/ShiftMonthCalendar";

export const dynamic = "force-dynamic";

export default async function TechnicianClockPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const user = await getCurrentAppUser();
  if (!user) redirect("/login");
  if (!isFloorTech(user.role)) redirect(staffHomePath(user.role));

  const params = await searchParams;
  const month = params.month?.trim() || "";
  const currentMonthKey = shopDateKey(new Date()).slice(0, 7);

  const [openClock, shiftMonth] = await Promise.all([
    getOpenTimeClockEntry(user.user_id),
    getMyShiftMonth(month || null),
  ]);

  return (
    <div className="page-stack page-stack--narrow">
      <PageHeader
        title="Time clock"
        subtitle="Clock in and out for your shift. Review days you worked below."
      />
      <TimeClockWidget openEntry={openClock} />
      <ShiftMonthCalendar
        calendar={shiftMonth.calendar}
        entries={shiftMonth.entries}
        currentMonthKey={currentMonthKey}
      />
    </div>
  );
}
