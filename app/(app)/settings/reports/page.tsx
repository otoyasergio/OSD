import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentAppUser } from "@/lib/auth/session";
import { canViewReports } from "@/lib/permissions";
import { getShopReportSummary, type ShopReportPeriod } from "@/lib/services/reports";
import { WORK_ORDER_STATUS_LABELS } from "@/lib/status/labels";
import { PageHeader } from "@/components/ui/PageHeader";

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
  searchParams: Promise<{ period?: string }>;
}) {
  const user = await getCurrentAppUser();
  if (!user) redirect("/login");
  if (!canViewReports(user.role)) redirect("/dashboard");

  const { period: periodParam } = await searchParams;
  const period: ShopReportPeriod = periodParam === "7d" ? "7d" : "30d";
  const report = await getShopReportSummary(period);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Shop reports"
        subtitle="Throughput, revenue, cycle time, and labour for the active location."
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
        <StatCard label="Parts waiting" value={String(report.parts_waiting)} />
      </div>

      <section className="card card-pad">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
          Open work orders by status
        </h2>
        {report.by_status.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-600">No open work orders.</p>
        ) : (
          <ul className="mt-3 divide-y divide-zinc-100">
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
      <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
        {label}
      </p>
      <p className="mt-2 text-2xl font-semibold tabular-nums text-zinc-900">{value}</p>
    </div>
  );
}
