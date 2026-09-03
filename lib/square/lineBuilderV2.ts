import { HST_LINE_NAME } from "@/lib/pricing/hst";

/**
 * Pure builder for Square invoice line items from a CONFIRMED estimate
 * version. Only approved jobs bill; declined/deferred jobs are excluded.
 * The HST line is the exact sum of per-job tax cents captured at estimate
 * time — never recomputed — so the Square document always matches the
 * issued invoice to the cent.
 */

export type ConfirmedEstimateJob = {
  job_id: string;
  title_snapshot: string;
  /** Job total including tax (estimate_job.total_cents). */
  total_cents: number;
  /** Per-job tax rounded at estimate time (estimate_job.tax_cents). */
  tax_cents: number;
};

export type ConfirmedEstimateLine = {
  job_id: string | null;
  kind: string;
  description: string;
  /** Pre-tax extended amount (negative for discounts). */
  extended_amount_cents: number;
  position: number;
};

export type ConfirmedJobDecision = {
  job_id: string;
  decision: string;
};

export type SquareDraftLineV2 = {
  name: string;
  quantity: string;
  /** Pre-tax cents (negative allowed for discounts). */
  amountCents: number;
};

export type SquareLineBuildResult = {
  lineItems: SquareDraftLineV2[];
  /** Pre-tax approved scope (matches invoice.subtotal_cents). */
  subtotalCents: number;
  /** Exact summed per-job tax (matches invoice.tax_cents). */
  hstCents: number;
  /** subtotal + hst (matches invoice.total_cents / sum of lineItems). */
  totalCents: number;
};

export function approvedJobIds(decisions: ConfirmedJobDecision[]): Set<string> {
  return new Set(decisions.filter((d) => d.decision === "approved").map((d) => d.job_id));
}

export function buildSquareLinesFromConfirmedScope(input: {
  jobs: ConfirmedEstimateJob[];
  lines: ConfirmedEstimateLine[];
  decisions: ConfirmedJobDecision[];
  hstLineName?: string;
}): SquareLineBuildResult {
  const approved = approvedJobIds(input.decisions);
  const jobs = input.jobs.filter((job) => approved.has(job.job_id));

  const lineItems: SquareDraftLineV2[] = [];
  let subtotalCents = 0;
  let hstCents = 0;

  for (const job of jobs) {
    const preTaxCents = job.total_cents - job.tax_cents;
    subtotalCents += preTaxCents;
    hstCents += job.tax_cents;

    const jobLines = input.lines
      .filter((line) => line.job_id === job.job_id)
      .sort((a, b) => a.position - b.position);

    if (jobLines.length === 0) {
      lineItems.push({
        name: job.title_snapshot,
        quantity: "1",
        amountCents: preTaxCents,
      });
      continue;
    }

    let jobLineSum = 0;
    for (const line of jobLines) {
      jobLineSum += line.extended_amount_cents;
      lineItems.push({
        name: line.description,
        quantity: "1",
        amountCents: line.extended_amount_cents,
      });
    }

    // Guard against drift between line detail and the job snapshot totals:
    // the invoice bills from estimate_job totals, so reconcile to the cent.
    const drift = preTaxCents - jobLineSum;
    if (drift !== 0) {
      lineItems.push({
        name: `${job.title_snapshot} — adjustment`,
        quantity: "1",
        amountCents: drift,
      });
    }
  }

  if (hstCents > 0) {
    lineItems.push({
      name: input.hstLineName ?? HST_LINE_NAME,
      quantity: "1",
      amountCents: hstCents,
    });
  }

  return {
    lineItems,
    subtotalCents,
    hstCents,
    totalCents: subtotalCents + hstCents,
  };
}
