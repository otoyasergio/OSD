import Link from "next/link";
import { redirect } from "next/navigation";
import { getRolePreviewContext } from "@/lib/auth/role-preview";
import { canViewReports } from "@/lib/permissions";
import { getShopReportSummary, type ShopReportPeriod } from "@/lib/services/reports";
import {
  getAttendanceAnalytics,
  type AttendanceAnalyticsPeriod,
} from "@/lib/services/attendanceAnalytics";
import { WORK_ORDER_STATUS_LABELS } from "@/lib/status/labels";
import { PageHeader } from "@/components/ui/PageHeader";
import { HrmsSuggestionsPanel } from "@/components/reports/HrmsSuggestionsPanel";

export const dynamic = "force-dynamic";

function formatMoney(cents: number): string {
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
  }).format(cents / 100);
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; attendance?: string }>;
}) {
  const preview = await getRolePreviewContext();
  if (!preview) redirect("/login");
  if (!canViewReports(preview.role)) redirect("/dashboard");

  const { period: periodParam, attendance: attendanceParam } = await searchParams;
  const period: ShopReportPeriod = periodParam === "7d" ? "7d" : "30d";
  const attendancePeriod: AttendanceAnalyticsPeriod =
    attendanceParam === "7d" || attendanceParam === "30d" ? attendanceParam : "week";
  const [report, attendance] = await Promise.all([
    getShopReportSummary(period),
    getAttendanceAnalytics(attendancePeriod),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Shop reports"
        subtitle="Throughput, revenue, cycle time, labour, and Ontario ESA-oriented attendance insights."
      />

      <div className="flex flex-wrap gap-2">
        <Link
          href="/settings/reports?period=7d"
          className={
            period === "7d" ? "btn btn-primary text-sm" : "btn btn-secondary text-sm"
          }
        >
          Last 7 days
        </Link>
        <Link
          href="/settings/reports?period=30d"
          className={
            period === "30d" ? "btn btn-primary text-sm" : "btn btn-secondary text-sm"
          }
        >
          Last 30 days
        </Link>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <StatCard
          label="Work orders created"
          value={String(report.work_orders_created)}
        />
        <StatCard
          label="Work orders completed"
          value={String(report.work_orders_completed)}
        />
        <StatCard
          label="Revenue collected"
          value={formatMoney(report.revenue_collected_cents)}
        />
        <StatCard
          label="Avg days in shop"
          value={report.avg_days_in_shop == null ? "—" : String(report.avg_days_in_shop)}
        />
        <StatCard label="Tech hours punched" value={String(report.tech_hours)} />
        <StatCard label="Job hours (bay)" value={String(report.job_hours)} />
        <StatCard
          label="Efficiency (job ÷ attendance)"
          value={report.efficiency_pct == null ? "—" : `${report.efficiency_pct}%`}
        />
        <StatCard label="Parts waiting" value={String(report.parts_waiting)} />
      </div>

      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <h2 className="text-lg font-semibold text-foreground">
            Attendance &amp; labour
          </h2>
          <div className="flex flex-wrap gap-2">
            {(
              [
                ["week", "This week"],
                ["7d", "7 days"],
                ["30d", "30 days"],
              ] as const
            ).map(([key, label]) => (
              <Link
                key={key}
                href={`/settings/reports?period=${period}&attendance=${key}`}
                className={
                  attendancePeriod === key
                    ? "btn btn-primary text-sm"
                    : "btn btn-secondary text-sm"
                }
              >
                {label}
              </Link>
            ))}
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Paid hours" value={String(attendance.total_paid_hours)} />
          <StatCard label="OT hours" value={String(attendance.total_ot_hours)} />
          <StatCard label="Meal misses" value={String(attendance.meal_miss_count)} />
          <StatCard
            label="Currently signed in"
            value={String(attendance.currently_signed_in)}
          />
        </div>
        <div className="card card-pad overflow-x-auto">
          <table className="w-full min-w-[32rem] text-left text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] text-[var(--status-neutral)]">
                <th className="py-2 pr-3 font-medium">Staff</th>
                <th className="py-2 pr-3 font-medium">Paid</th>
                <th className="py-2 pr-3 font-medium">OT</th>
                <th className="py-2 pr-3 font-medium">Meal misses</th>
                <th className="py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {attendance.staff.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-3 text-[var(--status-neutral)]">
                    No staff attendance in this period.
                  </td>
                </tr>
              ) : (
                attendance.staff.map((row) => (
                  <tr key={row.user_id} className="border-b border-[var(--border)]">
                    <td className="py-2 pr-3">
                      <Link
                        href={`/settings/staff/${row.user_id}`}
                        className="font-medium underline"
                      >
                        {row.display_name}
                      </Link>
                    </td>
                    <td className="py-2 pr-3 tabular-nums">{row.paid_hours}</td>
                    <td className="py-2 pr-3 tabular-nums">{row.ot_hours}</td>
                    <td className="py-2 pr-3 tabular-nums">{row.meal_misses}</td>
                    <td className="py-2 text-[var(--status-neutral)]">
                      {row.open_punch_hours != null
                        ? `Signed in (${row.open_punch_hours.toFixed(1)}h)`
                        : "Signed out"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          <p className="mt-3 text-xs text-[var(--status-neutral)]">
            Paid hours deduct unpaid meal breaks. OT uses the Ontario 44h weekly threshold
            for the current shop week.{" "}
            <Link href="/settings/timesheets" className="underline">
              Open timesheets
            </Link>
          </p>
        </div>
      </section>

      <HrmsSuggestionsPanel suggestions={attendance.suggestions} />

      <section className="card card-pad">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--status-neutral)]">
          Open work orders by status
        </h2>
        {report.by_status.length === 0 ? (
          <p className="mt-3 text-sm text-[var(--status-neutral)]">
            No open work orders.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-[var(--border)]">
            {report.by_status.map((row) => (
              <li
                key={row.status}
                className="flex items-center justify-between py-2 text-sm"
              >
                <span>{WORK_ORDER_STATUS_LABELS[row.status] ?? row.status}</span>
                <span className="font-semibold tabular-nums">{row.count}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="card card-pad">
      <p className="text-xs font-semibold uppercase tracking-wide text-[var(--status-neutral)]">
        {label}
      </p>
      <p className="mt-2 text-2xl font-semibold tabular-nums text-foreground">{value}</p>
    </div>
  );
}
