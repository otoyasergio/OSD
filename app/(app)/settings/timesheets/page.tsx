import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentAppUser } from "@/lib/auth/session";
import { canManageTimesheets } from "@/lib/permissions";
import {
  getTimesheetWeek,
  listTimesheetStaff,
} from "@/lib/services/timeClock";
import { TimesheetsPanel } from "@/components/timesheets/TimesheetsPanel";
import { shopDateKey } from "@/lib/datetime/format";

export const dynamic = "force-dynamic";

export default async function TimesheetsPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  const user = await getCurrentAppUser();
  if (!user) redirect("/login");
  if (!canManageTimesheets(user.role)) redirect("/settings");

  const params = await searchParams;
  const week = params.week?.trim() || "";

  const [view, staff] = await Promise.all([
    getTimesheetWeek(week || null),
    listTimesheetStaff(),
  ]);

  const weekParam = week || view.range.startDateKey || shopDateKey(new Date());

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Link
          href="/settings"
          className="text-sm text-zinc-600 underline-offset-2 hover:underline"
        >
          ← Settings
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-900">
          Timesheets
        </h1>
        <p className="mt-1 text-sm text-zinc-600">
          Who is punched in, weekly hours, and corrections for missed punches.
          Technician clock in/out stays on the Technician page.
        </p>
      </div>

      <TimesheetsPanel
        range={view.range}
        open={view.open}
        entries={view.entries}
        summaries={view.summaries}
        staff={staff}
        weekParam={weekParam}
      />
    </div>
  );
}
