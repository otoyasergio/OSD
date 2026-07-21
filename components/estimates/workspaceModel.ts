import {
  priceJob,
  totalEstimate,
  type EstimateTotals,
  type JobPricingInput,
} from "@/lib/jobs-v2/pricing";
import { mapLegacyJobStatus } from "@/lib/jobs-v2/statusMapping";
import type {
  AuthorizationDecision,
  JobPricingMode,
  JobStatus,
} from "@/lib/database/types";
import type { StageChipTone } from "@/components/ui/StageChip";
import type { EstimateJobDraft } from "@/lib/services/estimatePricing";

/**
 * Pure client-side model for the Estimate & Jobs workspace. Pricing math is
 * delegated to lib/jobs-v2/pricing (the same functions the server snapshot
 * builder uses) so the on-screen totals always match what presentEstimate
 * freezes. This module must stay free of server-only imports.
 */

export const CAD = new Intl.NumberFormat("en-CA", {
  style: "currency",
  currency: "CAD",
});

export function formatCents(cents: number): string {
  return CAD.format(cents / 100);
}

/** Dollars text → integer cents. Empty/invalid/negative input → null. */
export function parseMoneyInputToCents(text: string): number | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.round(value * 100);
}

export type WorkspaceJob = {
  job_id: string;
  title: string;
  status: JobStatus;
  /** Legacy labour/service dollars used to seed the labour input. */
  standard_price_snapshot: number | null;
  assigned_technician_name: string | null;
};

export type WorkspacePart = {
  part_id: string;
  job_id: string;
  part_name: string;
  quantity: number;
  unit_price: number | null;
  status: string;
};

const EXCLUDED_PART_STATUSES = new Set(["cancelled", "not_required"]);

export type JobPartsRollup = {
  count: number;
  knownTotalCents: number;
  missingPriceCount: number;
  lines: Array<{ quantity: number; sellPriceCents: number | null }>;
};

/** Read-only parts rollup per job (priced on the Parts tab, never here). */
export function rollupPartsForJob(parts: WorkspacePart[], jobId: string): JobPartsRollup {
  const relevant = parts.filter(
    (part) => part.job_id === jobId && !EXCLUDED_PART_STATUSES.has(part.status)
  );
  let knownTotalCents = 0;
  let missingPriceCount = 0;
  const lines = relevant.map((part) => {
    const sellPriceCents =
      part.unit_price == null ? null : Math.round(Number(part.unit_price) * 100);
    if (sellPriceCents === null) {
      missingPriceCount += 1;
    } else {
      knownTotalCents += Math.round(part.quantity * sellPriceCents);
    }
    return { quantity: Number(part.quantity ?? 0), sellPriceCents };
  });
  return { count: relevant.length, knownTotalCents, missingPriceCount, lines };
}

export type JobPricingFormState = {
  mode: JobPricingMode;
  labourText: string;
  packageText: string;
  feeText: string;
  discountText: string;
};

export function seedPricingState(job: WorkspaceJob): JobPricingFormState {
  const dollars =
    job.standard_price_snapshot == null ? "" : String(job.standard_price_snapshot);
  return {
    mode: "itemized",
    labourText: dollars,
    packageText: dollars,
    feeText: "",
    discountText: "",
  };
}

/** Jobs that belong on the estimate workspace list (cancelled never bills). */
export function estimableJobs<T extends { status: JobStatus }>(jobs: T[]): T[] {
  return jobs.filter((job) => job.status !== "cancelled");
}

/**
 * Only jobs still awaiting a customer decision go onto a NEW presented
 * version. Approved / in-progress / completed work is already authorized —
 * re-presenting it would make estimate confirmation rewrite its legacy
 * status (the confirm command dual-writes approved/declined) and yank
 * in-flight work back to planned. Declined jobs may be re-asked.
 */
export function jobNeedsAuthorization(status: JobStatus): boolean {
  return status === "draft" || status === "waiting_for_approval" || status === "declined";
}

export function presentableJobs<T extends { status: JobStatus }>(jobs: T[]): T[] {
  return jobs.filter((job) => jobNeedsAuthorization(job.status));
}

export function buildJobDraft(
  job: WorkspaceJob,
  partsRollup: JobPartsRollup,
  state: JobPricingFormState
): EstimateJobDraft {
  const isPackage = state.mode === "fixed_package";
  const labourCents = parseMoneyInputToCents(state.labourText) ?? 0;
  const feeCents = parseMoneyInputToCents(state.feeText) ?? 0;
  const discountCents = parseMoneyInputToCents(state.discountText) ?? 0;

  const pricing: JobPricingInput & { pricingMode: JobPricingMode } = {
    pricingMode: state.mode,
    fixedPackagePriceCents: isPackage ? parseMoneyInputToCents(state.packageText) : null,
    laborLines:
      labourCents > 0
        ? [{ amountCents: labourCents, billable: true, includedInPackage: isPackage }]
        : [],
    partLines: partsRollup.lines.map((line) => ({
      quantity: line.quantity,
      sellPriceCents: line.sellPriceCents,
      includedInPackage: isPackage,
    })),
    feeLines: feeCents > 0 ? [{ amountCents: feeCents, includedInPackage: false }] : [],
    discountLines: discountCents > 0 ? [{ amountCents: discountCents }] : [],
  };

  return {
    jobId: job.job_id,
    title: job.title,
    description: null,
    pricing,
  };
}

export function buildWorkspaceDrafts(
  jobs: WorkspaceJob[],
  parts: WorkspacePart[],
  stateByJob: Record<string, JobPricingFormState>
): EstimateJobDraft[] {
  return presentableJobs(jobs).map((job) =>
    buildJobDraft(
      job,
      rollupPartsForJob(parts, job.job_id),
      stateByJob[job.job_id] ?? seedPricingState(job)
    )
  );
}

export function computeWorkspaceTotals(drafts: EstimateJobDraft[]): EstimateTotals {
  return totalEstimate(drafts.map((draft) => priceJob(draft.pricing)));
}

export function priceDraft(draft: EstimateJobDraft) {
  return priceJob(draft.pricing);
}

/**
 * Client-side presentation gate. Mirrors the codes of
 * lib/services/estimatePricing presentationBlockers (which the server action
 * re-checks authoritatively); the unit tests pin the two to each other.
 */
export function workspacePresentationBlockers(
  drafts: EstimateJobDraft[],
  totals: EstimateTotals
): string[] {
  const blockers: string[] = [];
  if (drafts.length === 0) blockers.push("ESTIMATE_EMPTY");
  if (totals.missingPriceCount > 0) blockers.push("ESTIMATE_MISSING_PRICES");
  if (totals.subtotalCents < 0 || totals.totalCents < 0) {
    blockers.push("ESTIMATE_NEGATIVE_TOTAL");
  }
  return blockers;
}

export const BLOCKER_MESSAGES: Record<string, string> = {
  ESTIMATE_EMPTY: "Add at least one job before presenting.",
  ESTIMATE_MISSING_PRICES:
    "Missing prices — set part retail prices on the Parts tab (and a package price for package jobs).",
  ESTIMATE_NEGATIVE_TOTAL: "The estimate total cannot be negative.",
};

export function blockerMessage(code: string): string {
  return BLOCKER_MESSAGES[code] ?? code;
}

// ---------------------------------------------------------------------------
// Chips
// ---------------------------------------------------------------------------

export type ChipModel = { label: string; tone: StageChipTone };

const WORK_STATE_LABELS: Record<string, string> = {
  planned: "Planned",
  ready: "Ready",
  in_progress: "In progress",
  completed: "Completed",
  cancelled: "Cancelled",
};

/** Work-progress facet chip derived from the legacy job status. */
export function workProgressChip(status: JobStatus): ChipModel {
  const facets = mapLegacyJobStatus(status);
  const label = WORK_STATE_LABELS[facets.workState] ?? facets.workState;
  if (facets.workState === "in_progress") return { label, tone: "orange" };
  if (facets.workState === "ready") return { label, tone: "teal" };
  return { label, tone: "muted" };
}

/**
 * Authorization chip. The live estimate decision is authoritative; jobs not
 * on the presented version fall back to the legacy status facets.
 */
export function authorizationChip(
  legacyStatus: JobStatus,
  liveDecision: AuthorizationDecision | null | undefined,
  onPresentedVersion: boolean
): ChipModel {
  if (onPresentedVersion) {
    if (liveDecision === "approved") return { label: "Approved", tone: "teal" };
    if (liveDecision === "declined") return { label: "Declined", tone: "danger" };
    if (liveDecision === "deferred") return { label: "Deferred", tone: "muted" };
    return { label: "Pending decision", tone: "orange" };
  }
  const facets = mapLegacyJobStatus(legacyStatus);
  if (facets.authorization === "approved") return { label: "Approved", tone: "teal" };
  if (facets.authorization === "declined") return { label: "Declined", tone: "danger" };
  if (facets.authorization === "deferred") return { label: "Deferred", tone: "muted" };
  if (facets.presented) return { label: "Pending decision", tone: "orange" };
  return { label: "Draft — not presented", tone: "muted" };
}

// ---------------------------------------------------------------------------
// Decisions + amendment
// ---------------------------------------------------------------------------

export type StaffDecision = "approved" | "declined";
export type DecisionMap = Record<string, StaffDecision | undefined>;

export function decisionsComplete(jobIds: string[], decisions: DecisionMap): boolean {
  return jobIds.length > 0 && jobIds.every((jobId) => Boolean(decisions[jobId]));
}

export function toDecisionList(
  jobIds: string[],
  decisions: DecisionMap
): Array<{ jobId: string; decision: StaffDecision }> {
  return jobIds.flatMap((jobId) => {
    const decision = decisions[jobId];
    return decision ? [{ jobId, decision }] : [];
  });
}

/**
 * Editing prices after a version went out is an amendment: presenting again
 * creates version N+1 and supersedes the live one (presentEstimate handles
 * the supersede transactionally).
 */
export function amendmentNotice(
  live: { version_no: number; status: string } | null,
  dirty: boolean
): string | null {
  if (!live || !dirty) return null;
  if (live.status !== "presented" && live.status !== "confirmed") return null;
  return `Amendment — will create version ${live.version_no + 1} (version ${
    live.version_no
  } will be superseded).`;
}

export const ESTIMATE_STATUS_CHIPS: Record<string, ChipModel> = {
  draft: { label: "Draft", tone: "muted" },
  presented: { label: "Presented", tone: "orange" },
  confirmed: { label: "Confirmed", tone: "teal" },
  superseded: { label: "Superseded", tone: "muted" },
  void: { label: "Void", tone: "danger" },
};

export function estimateStatusChip(status: string): ChipModel {
  return ESTIMATE_STATUS_CHIPS[status] ?? { label: status, tone: "muted" };
}
