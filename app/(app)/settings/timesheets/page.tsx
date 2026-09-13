import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentAppUser } from "@/lib/auth/session";
import { getRolePreviewContext } from "@/lib/auth/role-preview";
import { canManageTimesheets } from "@/lib/permissions";
import {
  getClockWidgetState,
  getTimesheetWeek,
  listTimesheetStaff,
} from "@/lib/services/timeClock";
import { getAttendanceAnalytics } from "@/lib/services/attendanceAnalytics";
import { TimesheetsPanel } from "@/components/timesheets/TimesheetsPanel";
import { TimeClockWidget } from "@/components/technician/TimeClockWidget";
import { HrmsSuggestionsPanel } from "@/components/reports/HrmsSuggestionsPanel";
import { shopDateKey } from "@/lib/datetime/format";

export const dynamic = "force-dynamic";

export default async function TimesheetsPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  const user = await getCurrentAppUser();
  if (!user) redirect("/login");
  const preview = await getRolePreviewContext();
  if (!canManageTimesheets(preview?.role ?? user.role)) redirect("/settings");

  const params = await searchParams;
  const week = params.week?.trim() || "";

  const [view, staff, clockState, attendance] = await Promise.all([
    getTimesheetWeek(week || null),
    listTimesheetStaff(),
    getClockWidgetState(user.user_id),
    getAttendanceAnalytics("week"),
  ]);

  const weekParam = week || view.range.startDateKey || shopDateKey(new Date());

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Link
          href="/settings"
          className="text-sm text-[var(--status-neutral)] underline-offset-2 hover:underline"
        >
          ← Settings
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground">
          Timesheets
        </h1>
        <p className="mt-1 text-sm text-[var(--status-neutral)]">
          Clock yourself in below, then manage staff punches, breaks, overtime after 44h,
          and approvals. Floor staff punch on the tablet kiosk (with photos).
        </p>
      </div>

      <HrmsSuggestionsPanel suggestions={attendance.suggestions.slice(0, 6)} />

      <section className="rounded-lg border border-[var(--chrome-border)] bg-[var(--surface)] p-4">
        <h2 className="mb-3 text-lg font-semibold text-foreground">Your clock</h2>
        <TimeClockWidget
          openEntry={clockState.openEntry}
          openBreak={clockState.openBreak}
          mealBreakNudge={clockState.mealBreakNudge}
        />
      </section>

      <TimesheetsPanel
        range={view.range}
        open={view.open}
        entries={view.entries}
        summaries={view.summaries}
        staff={staff}
        weeksByUser={view.weeksByUser}
        weekParam={weekParam}
      />
    </div>
  );
}
