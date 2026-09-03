import { createHash } from "node:crypto";
import type { JobPricingMode } from "@/lib/database/types";
import {
  priceJob,
  totalEstimate,
  type EstimateTotals,
  type JobPricingBreakdown,
  type JobPricingInput,
} from "@/lib/jobs-v2/pricing";
import type { EstimateLineInput, MoneyCents } from "@/lib/jobs-v2/types";

/**
 * Pure builder: job pricing inputs → immutable estimate version snapshot
 * (per-job summaries, ordered lines, totals, and the content hash frozen at
 * presentation). No database access — services persist what this returns.
 */

export type EstimateJobDraft = {
  jobId: string;
  title: string;
  description: string | null;
  pricing: JobPricingInput & { pricingMode: JobPricingMode };
};

export type EstimateJobSnapshot = {
  jobId: string;
  displayOrder: number;
  title: string;
  description: string | null;
  pricingMode: JobPricingMode;
  breakdown: JobPricingBreakdown;
};

export type EstimateVersionSnapshot = {
  jobs: EstimateJobSnapshot[];
  lines: EstimateLineInput[];
  totals: EstimateTotals;
  contentHash: string;
};

function stableHash(payload: unknown): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function pushLine(
  lines: EstimateLineInput[],
  line: Omit<EstimateLineInput, "position">
): void {
  lines.push({ ...line, position: lines.length });
}

export function buildEstimateVersionSnapshot(
  drafts: EstimateJobDraft[]
): EstimateVersionSnapshot {
  const jobs: EstimateJobSnapshot[] = [];
  const lines: EstimateLineInput[] = [];

  drafts.forEach((draft, index) => {
    const breakdown = priceJob(draft.pricing);
    jobs.push({
      jobId: draft.jobId,
      displayOrder: index,
      title: draft.title,
      description: draft.description,
      pricingMode: draft.pricing.pricingMode,
      breakdown,
    });

    const taxRateBps = draft.pricing.taxRateBps ?? 1300;
    const isPackage = draft.pricing.pricingMode === "fixed_package";
    const isNoCharge = draft.pricing.pricingMode === "no_charge";

    if (isNoCharge) {
      pushLine(lines, {
        kind: "fee",
        job_id: draft.jobId,
        description: `${draft.title} (no charge)`,
        quantity: 1,
        unit_amount_cents: 0,
        extended_amount_cents: 0,
        tax_rate_bps: taxRateBps,
        tax_amount_cents: 0,
      });
      return;
    }

    if (isPackage) {
      pushLine(lines, {
        kind: "package",
        job_id: draft.jobId,
        description: draft.title,
        quantity: 1,
        unit_amount_cents: breakdown.packageCents,
        extended_amount_cents: breakdown.packageCents,
        tax_rate_bps: taxRateBps,
        tax_amount_cents: 0,
      });
    }

    for (const labor of draft.pricing.laborLines) {
      if (!labor.billable) continue;
      if (isPackage && labor.includedInPackage) continue;
      pushLine(lines, {
        kind: "labor",
        job_id: draft.jobId,
        description: `${draft.title} — labour`,
        quantity: 1,
        unit_amount_cents: labor.amountCents,
        extended_amount_cents: labor.amountCents,
        tax_rate_bps: taxRateBps,
        tax_amount_cents: 0,
      });
    }

    for (const part of draft.pricing.partLines) {
      if (isPackage && part.includedInPackage) continue;
      const unit = part.sellPriceCents ?? 0;
      pushLine(lines, {
        kind: "part",
        job_id: draft.jobId,
        description: `${draft.title} — part`,
        quantity: part.quantity,
        unit_amount_cents: unit,
        extended_amount_cents: Math.round(part.quantity * unit),
        tax_rate_bps: taxRateBps,
        tax_amount_cents: 0,
      });
    }

    for (const fee of draft.pricing.feeLines) {
      if (isPackage && fee.includedInPackage) continue;
      pushLine(lines, {
        kind: "fee",
        job_id: draft.jobId,
        description: `${draft.title} — fee`,
        quantity: 1,
        unit_amount_cents: fee.amountCents,
        extended_amount_cents: fee.amountCents,
        tax_rate_bps: taxRateBps,
        tax_amount_cents: 0,
      });
    }

    for (const discount of draft.pricing.discountLines) {
      pushLine(lines, {
        kind: "discount",
        job_id: draft.jobId,
        description: `${draft.title} — discount`,
        quantity: 1,
        unit_amount_cents: -discount.amountCents,
        extended_amount_cents: -discount.amountCents,
        tax_rate_bps: taxRateBps,
        tax_amount_cents: 0,
      });
    }

    // The job's tax is carried on its last line so per-job rounding is the
    // persisted contract (matching lib/jobs-v2/pricing totalEstimate rules).
    const jobLines = lines.filter((line) => line.job_id === draft.jobId);
    const lastLine = jobLines[jobLines.length - 1];
    if (lastLine) lastLine.tax_amount_cents = breakdown.taxCents;
  });

  const totals = totalEstimate(jobs.map((job) => job.breakdown));

  return {
    jobs,
    lines,
    totals,
    contentHash: computeEstimateContentHash(jobs, lines, totals),
  };
}

export function computeEstimateContentHash(
  jobs: EstimateJobSnapshot[],
  lines: EstimateLineInput[],
  totals: EstimateTotals
): string {
  return stableHash({
    jobs: jobs.map((job) => ({
      jobId: job.jobId,
      order: job.displayOrder,
      title: job.title,
      mode: job.pricingMode,
      subtotal: job.breakdown.subtotalCents,
      tax: job.breakdown.taxCents,
      total: job.breakdown.totalCents,
    })),
    lines: lines.map((line) => ({
      kind: line.kind,
      jobId: line.job_id,
      description: line.description,
      quantity: line.quantity,
      unit: line.unit_amount_cents,
      extended: line.extended_amount_cents,
      taxBps: line.tax_rate_bps,
      tax: line.tax_amount_cents,
      position: line.position,
    })),
    totals,
  });
}

/** Presentation is blocked until every priced line is complete. */
export function presentationBlockers(snapshot: EstimateVersionSnapshot): string[] {
  const blockers: string[] = [];
  if (snapshot.jobs.length === 0) blockers.push("ESTIMATE_EMPTY");
  if (snapshot.totals.missingPriceCount > 0) {
    blockers.push("ESTIMATE_MISSING_PRICES");
  }
  if (snapshot.totals.subtotalCents < 0 || snapshot.totals.totalCents < 0) {
    blockers.push("ESTIMATE_NEGATIVE_TOTAL");
  }
  return blockers;
}

export type { EstimateTotals, JobPricingBreakdown, MoneyCents };
