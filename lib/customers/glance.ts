export type CustomerVisitForGlance = {
  status: string;
  completed_at: string | null;
  date_created: string;
  billing_collected_cents?: number | null;
};

export type CustomerGlance = {
  /** Non-completed visits, matching the profile's open list (includes cancelled). */
  open_visit_count: number;
  completed_visit_count: number;
  last_visit_at: string | null;
  /** Sum of collected cents on every work order, including deposits on open visits. */
  collected_cents: number;
};

/** Desk totals for one customer, from the same visit rows the profile lists. */
export function summarizeCustomerVisits(
  visits: CustomerVisitForGlance[]
): CustomerGlance {
  let openVisitCount = 0;
  let completedVisitCount = 0;
  let collectedCents = 0;
  let lastVisitAt: string | null = null;

  for (const visit of visits) {
    if (visit.status === "completed") completedVisitCount += 1;
    else openVisitCount += 1;

    const cents = Number(visit.billing_collected_cents ?? 0);
    if (Number.isFinite(cents)) collectedCents += cents;

    const stamp = visit.completed_at || visit.date_created;
    if (stamp && (lastVisitAt === null || stamp > lastVisitAt)) lastVisitAt = stamp;
  }

  return {
    open_visit_count: openVisitCount,
    completed_visit_count: completedVisitCount,
    last_visit_at: lastVisitAt,
    collected_cents: collectedCents,
  };
}
