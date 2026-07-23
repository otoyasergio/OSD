import type {
  AuthorizationDecision,
  EstimateStatus,
  JobWorkState,
  WorkOrderDisplayStage,
  WorkOrderLifecycleState,
} from "@/lib/database/types";
import type { MoneyCents, WorkOrderRollup } from "@/lib/jobs-v2/types";

/**
 * Derived work-order rollup. The display stage is a projection for boards;
 * it never becomes writable authority. Rule that fixes the legacy freeze
 * bug: authorized actionable work always outranks pending optional
 * decisions, which surface as a count/badge instead of hiding the shop's
 * real state.
 */

export type RollupJobFacts = {
  workState: JobWorkState;
  /** Effective decision from the live presented/confirmed version. */
  authorization: AuthorizationDecision | null;
  /** Included on the live presented estimate version. */
  presented: boolean;
  partsReady: boolean;
  hasOpenPartsBlocker: boolean;
};

export type WorkOrderRollupInput = {
  lifecycleState: WorkOrderLifecycleState;
  jobs: RollupJobFacts[];
  estimateStatus: EstimateStatus | null;
  hasOpenFindings: boolean;
  /** Authorized completed scope still needs a passing QC attempt. */
  qcRequired: boolean;
  /** QC passed but safety attempt still outstanding (when applicable). */
  safetyRequired: boolean;
  invoiceBalanceCents: MoneyCents;
  invoicePaid: boolean;
};

function isAuthorized(job: RollupJobFacts): boolean {
  return job.authorization === "approved";
}

function isActive(job: RollupJobFacts): boolean {
  return job.workState !== "cancelled";
}

export function deriveWorkOrderRollup(input: WorkOrderRollupInput): WorkOrderRollup {
  const jobs = input.jobs.filter(isActive);

  const pendingDecisionCount = jobs.filter(
    (job) => job.presented && job.authorization === null
  ).length;

  const waitingPartsCount = jobs.filter(
    (job) =>
      isAuthorized(job) &&
      (job.workState === "planned" || job.workState === "ready") &&
      (!job.partsReady || job.hasOpenPartsBlocker)
  ).length;

  const readyJobCount = jobs.filter(
    (job) =>
      isAuthorized(job) &&
      job.workState === "ready" &&
      job.partsReady &&
      !job.hasOpenPartsBlocker
  ).length;

  const inProgressCount = jobs.filter((job) => job.workState === "in_progress").length;
  const completedJobCount = jobs.filter((job) => job.workState === "completed").length;

  const authorizedJobs = jobs.filter(isAuthorized);
  const allAuthorizedComplete =
    authorizedJobs.length > 0 &&
    authorizedJobs.every((job) => job.workState === "completed");

  return {
    displayStage: deriveDisplayStage({
      input,
      pendingDecisionCount,
      waitingPartsCount,
      readyJobCount,
      inProgressCount,
      completedJobCount,
      allAuthorizedComplete,
    }),
    pendingDecisionCount,
    waitingPartsCount,
    readyJobCount,
    inProgressCount,
    completedJobCount,
    qcRequired: input.qcRequired,
    safetyRequired: input.safetyRequired,
    invoiceBalanceCents: input.invoiceBalanceCents,
  };
}

function deriveDisplayStage(args: {
  input: WorkOrderRollupInput;
  pendingDecisionCount: number;
  waitingPartsCount: number;
  readyJobCount: number;
  inProgressCount: number;
  completedJobCount: number;
  allAuthorizedComplete: boolean;
}): WorkOrderDisplayStage {
  const { input } = args;

  switch (input.lifecycleState) {
    case "cancelled":
      return "cancelled";
    case "closed":
      return "closed";
    case "on_hold":
      return "on_hold";
    case "draft":
      return "intake";
    case "active":
      break;
  }

  // Actionable authorized work always outranks pending optional decisions.
  if (args.inProgressCount > 0) return "in_progress";
  if (args.readyJobCount > 0) return "ready_to_work";
  if (args.waitingPartsCount > 0) return "parts_wait";

  if (args.allAuthorizedComplete && args.completedJobCount > 0) {
    if (input.qcRequired) return "qc";
    if (input.safetyRequired) return "safety";
    if (input.invoiceBalanceCents > 0) return "invoice_due";
    if (input.invoicePaid) return "paid";
    return "invoice_due";
  }

  if (args.pendingDecisionCount > 0) return "authorization_pending";
  if (input.estimateStatus === "presented") return "estimate_presented";
  if (input.estimateStatus === "draft") return "estimate_draft";
  if (input.hasOpenFindings) return "findings";
  return "intake";
}
