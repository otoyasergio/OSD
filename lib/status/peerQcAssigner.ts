export type PeerQcCandidate = {
  userId: string;
  openJobCount: number;
  openQcCount: number;
};

/**
 * Pick the least-loaded clocked-in tech who did not work the WO jobs.
 * Returns null when nobody is eligible.
 */
export function pickPeerQcAssignee(input: {
  workerUserIds: string[];
  candidates: PeerQcCandidate[];
}): string | null {
  const workers = new Set(input.workerUserIds.filter(Boolean));
  const eligible = input.candidates
    .filter((c) => !workers.has(c.userId))
    .slice()
    .sort((a, b) => {
      const loadA = a.openJobCount + a.openQcCount;
      const loadB = b.openJobCount + b.openQcCount;
      if (loadA !== loadB) return loadA - loadB;
      return a.userId.localeCompare(b.userId);
    });
  return eligible[0]?.userId ?? null;
}
