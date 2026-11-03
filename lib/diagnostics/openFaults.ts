export type OpenFaultMotorcycle = {
  motorcycle_id: string;
  customer_id: string;
};

export type OpenFaultSession = {
  session_id: string;
  motorcycle_id: string;
  recorded_at: string;
  scan_results: string;
};

/** Newest complete scan per motorcycle. A later partial scan does not replace it. */
export function latestCompleteSessions(sessions: OpenFaultSession[]): OpenFaultSession[] {
  const latest = new Map<string, OpenFaultSession>();
  for (const session of sessions) {
    if (session.scan_results !== "complete") continue;
    const current = latest.get(session.motorcycle_id);
    if (
      !current ||
      session.recorded_at > current.recorded_at ||
      (session.recorded_at === current.recorded_at &&
        session.session_id > current.session_id)
    ) {
      latest.set(session.motorcycle_id, session);
    }
  }
  return [...latest.values()];
}

/**
 * Bikes whose latest *complete* scan has at least one active fault.
 * A newer partial scan does not replace that complete result.
 */
export function countOpenFaultBikes(
  motorcycles: OpenFaultMotorcycle[],
  sessions: OpenFaultSession[],
  activeReadingSessionIds: Iterable<string>
): Map<string, number> {
  const latestComplete = new Map(
    latestCompleteSessions(sessions).map((session) => [session.motorcycle_id, session])
  );
  const active = new Set(activeReadingSessionIds);
  const counts = new Map<string, number>();
  for (const motorcycle of motorcycles) {
    const session = latestComplete.get(motorcycle.motorcycle_id);
    if (!session || !active.has(session.session_id)) continue;
    counts.set(motorcycle.customer_id, (counts.get(motorcycle.customer_id) ?? 0) + 1);
  }
  return counts;
}

/** `null` means the count could not be read. `0` is a real count. */
export function formatOpenFaultBikeCount(count: number | null): string {
  if (count === null) return "Open faults unavailable";
  const noun = count === 1 ? "bike" : "bikes";
  return `${count} ${noun} with open faults`;
}
