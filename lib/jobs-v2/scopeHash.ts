import { createHash } from "node:crypto";

/**
 * QC/safety attempts are recorded against an exact scope: the set of
 * completed authorized jobs (and when each completed) at the moment the
 * check ran. Rework or extra approved work changes the hash, so a pass on
 * an older scope can never be mistaken for a pass on the current one.
 */

export type QcScopeJob = {
  jobId: string;
  /** ISO timestamp; null tolerated for legacy rows that lost the stamp. */
  completedAt: string | null;
};

/**
 * Stable sha256 hex of the sorted (jobId, completedAt) pairs.
 * Input order never affects the result.
 */
export function computeQcScopeHash(jobs: QcScopeJob[]): string {
  const canonical = jobs
    .map((job) => `${job.jobId}@${job.completedAt ?? ""}`)
    .sort()
    .join("|");
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}
