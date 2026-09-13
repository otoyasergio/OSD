/**
 * Pure peer-QC completion rules shared by the legacy service path and the
 * V2 command wiring (lib/services/peerQc.ts).
 */

export type VisitJobForQc = {
  job_id: string;
  status: string;
  assigned_technician_id: string | null;
};

export type VisitTimeEntryForQc = {
  job_id: string;
  user_id: string;
};

/**
 * Everyone who worked ANY job on the visit: assigned technicians plus every
 * job_time_entry contributor. None of them may quality-check the visit.
 */
export function collectVisitWorkerIds(
  jobs: VisitJobForQc[],
  timeEntries: VisitTimeEntryForQc[]
): Set<string> {
  const workers = new Set<string>();
  for (const job of jobs) {
    if (job.assigned_technician_id) workers.add(job.assigned_technician_id);
  }
  for (const entry of timeEntries) {
    if (entry.user_id) workers.add(entry.user_id);
  }
  return workers;
}

/**
 * Filter QC candidates down to techs who did not touch the visit
 * (and are not the finisher asking for the check).
 */
export function filterEligibleQcCandidates<T extends { user_id: string }>(
  candidates: T[],
  workedUserIds: ReadonlySet<string>,
  excludeUserId?: string | null
): T[] {
  return candidates.filter(
    (candidate) =>
      candidate.user_id !== excludeUserId && !workedUserIds.has(candidate.user_id)
  );
}

/**
 * Legacy QC-fail rework update: reopen the job WITHOUT erasing when it was
 * originally started/completed — that history is evidence, and the V2
 * command path preserves it the same way.
 */
export function buildLegacyReworkJobUpdate(nowIso: string): {
  status: "ready_to_start";
  updated_at: string;
} {
  return { status: "ready_to_start", updated_at: nowIso };
}
