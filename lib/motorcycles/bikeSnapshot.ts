import type { WorkOrderStatus } from "@/lib/database/types";

export type BikeVisitForSnapshot = {
  status: WorkOrderStatus | string;
  completed_at: string | null;
  date_created: string;
  billing_collected_cents?: number | null;
};

export type BikeSnapshot = {
  visit_count: number;
  completed_visit_count: number;
  last_visit_at: string | null;
  days_since_last_visit: number | null;
  lifetime_collected_cents: number;
};

/** Desk snapshot for a motorcycle — visits, recency, and lifetime collected. */
export function buildBikeSnapshot(
  visits: BikeVisitForSnapshot[],
  now: Date = new Date()
): BikeSnapshot {
  const active = visits.filter((visit) => visit.status !== "cancelled");
  const completed = active.filter((visit) => visit.status === "completed");

  let lifetime = 0;
  for (const visit of completed) {
    lifetime += Number(visit.billing_collected_cents ?? 0);
  }

  const dated = active
    .map((visit) => visit.completed_at || visit.date_created)
    .filter(Boolean)
    .sort((a, b) => b.localeCompare(a));
  const lastVisitAt = dated[0] ?? null;

  let daysSince: number | null = null;
  if (lastVisitAt) {
    const ms = now.getTime() - new Date(lastVisitAt).getTime();
    if (Number.isFinite(ms) && ms >= 0) {
      daysSince = Math.floor(ms / (1000 * 60 * 60 * 24));
    }
  }

  return {
    visit_count: active.length,
    completed_visit_count: completed.length,
    last_visit_at: lastVisitAt,
    days_since_last_visit: daysSince,
    lifetime_collected_cents: lifetime,
  };
}
