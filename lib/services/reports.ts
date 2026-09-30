import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/database/supabase-server";
import { canViewReports } from "@/lib/permissions";
import type { WorkOrderStatus } from "@/lib/database/types";

export type ShopReportPeriod = "7d" | "30d";

export type ShopReportSummary = {
  period: ShopReportPeriod;
  location_id: string;
  work_orders_created: number;
  work_orders_completed: number;
  revenue_collected_cents: number;
  avg_days_in_shop: number | null;
  tech_hours: number;
  job_hours: number;
  efficiency_pct: number | null;
  parts_waiting: number;
  by_status: Array<{ status: WorkOrderStatus; count: number }>;
};

function periodStart(period: ShopReportPeriod): Date {
  const days = period === "7d" ? 7 : 30;
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCDate(start.getUTCDate() - (days - 1));
  return start;
}

export async function getShopReportSummary(
  period: ShopReportPeriod = "30d"
): Promise<ShopReportSummary> {
  const user = await requireUser();
  if (!canViewReports(user.role)) throw new Error("FORBIDDEN");

  const locationId = user.active_location_id!;
  const since = periodStart(period).toISOString();
  const supabase = await createClient();

  const [createdRes, completedRes, openRes, clockRes, jobTimeRes] = await Promise.all([
    supabase
      .from("work_order")
      .select("work_order_id, status, created_at, completed_at, billing_collected_cents")
      .eq("location_id", locationId)
      .gte("created_at", since),
    supabase
      .from("work_order")
      .select("work_order_id, created_at, completed_at, billing_collected_cents")
      .eq("location_id", locationId)
      .eq("status", "completed")
      .gte("completed_at", since),
    supabase
      .from("work_order")
      .select("status")
      .eq("location_id", locationId)
      .not("status", "in", '("completed","cancelled")'),
    supabase
      .from("time_clock_entry")
      .select("clock_in_at, clock_out_at, voided_at")
      .eq("location_id", locationId)
      .is("voided_at", null)
      .gte("clock_in_at", since),
    supabase
      .from("job_time_entry")
      .select("started_at, ended_at")
      .eq("location_id", locationId)
      .gte("started_at", since),
  ]);

  if (createdRes.error) throw createdRes.error;
  if (completedRes.error) throw completedRes.error;
  if (openRes.error) throw openRes.error;
  if (clockRes.error) throw clockRes.error;
  if (jobTimeRes.error) throw jobTimeRes.error;

  const { count: partsWaitingCount, error: partsError } = await supabase
    .from("part")
    .select("part_id, job!inner(work_order_id, work_order!inner(location_id))", {
      count: "exact",
      head: true,
    })
    .in("status", ["needed", "ordered", "in_stock"])
    .eq("job.work_order.location_id", locationId);

  const partsWaiting = partsError ? 0 : (partsWaitingCount ?? 0);

  const created = createdRes.data ?? [];
  const completed = completedRes.data ?? [];

  let revenue = 0;
  for (const row of completed) {
    revenue += Number(row.billing_collected_cents ?? 0);
  }

  const cycleDays: number[] = [];
  for (const row of completed) {
    if (!row.created_at || !row.completed_at) continue;
    const ms = new Date(row.completed_at).getTime() - new Date(row.created_at).getTime();
    if (ms >= 0) cycleDays.push(ms / (1000 * 60 * 60 * 24));
  }
  const avgDays =
    cycleDays.length > 0
      ? Math.round((cycleDays.reduce((a, b) => a + b, 0) / cycleDays.length) * 10) / 10
      : null;

  let techHours = 0;
  for (const entry of clockRes.data ?? []) {
    if (!entry.clock_in_at) continue;
    const end = entry.clock_out_at ? new Date(entry.clock_out_at).getTime() : Date.now();
    const start = new Date(entry.clock_in_at).getTime();
    if (end > start) techHours += (end - start) / (1000 * 60 * 60);
  }
  techHours = Math.round(techHours * 10) / 10;

  let jobHours = 0;
  for (const entry of jobTimeRes.data ?? []) {
    if (!entry.started_at) continue;
    const end = entry.ended_at ? new Date(entry.ended_at).getTime() : Date.now();
    const start = new Date(entry.started_at).getTime();
    if (end > start) jobHours += (end - start) / (1000 * 60 * 60);
  }
  jobHours = Math.round(jobHours * 10) / 10;

  const efficiency_pct =
    techHours > 0 ? Math.round((jobHours / techHours) * 1000) / 10 : null;

  const statusCounts = new Map<string, number>();
  for (const row of openRes.data ?? []) {
    const status = String(row.status);
    statusCounts.set(status, (statusCounts.get(status) ?? 0) + 1);
  }

  return {
    period,
    location_id: locationId,
    work_orders_created: created.length,
    work_orders_completed: completed.length,
    revenue_collected_cents: revenue,
    avg_days_in_shop: avgDays,
    tech_hours: techHours,
    job_hours: jobHours,
    efficiency_pct,
    parts_waiting: partsWaiting,
    by_status: Array.from(statusCounts.entries())
      .map(([status, count]) => ({
        status: status as WorkOrderStatus,
        count,
      }))
      .sort((a, b) => b.count - a.count),
  };
}
