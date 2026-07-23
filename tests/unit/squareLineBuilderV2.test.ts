import { describe, expect, it } from "vitest";
import { buildSquareLinesFromConfirmedScope } from "@/lib/square/lineBuilderV2";
import { HST_LINE_NAME } from "@/lib/pricing/hst";

// Confirmed version fixture: two approved jobs, one declined, one deferred.
// Invoice totals per workflow_v2_issue_invoice: subtotal = Σ(total - tax),
// tax = Σ(tax) over APPROVED estimate_job rows only.
const JOBS = [
  {
    job_id: "job-brakes",
    title_snapshot: "Brake service",
    total_cents: 22_600,
    tax_cents: 2_600,
  },
  {
    job_id: "job-chain",
    title_snapshot: "Chain + sprockets",
    total_cents: 45_198,
    tax_cents: 5_198,
  },
  {
    job_id: "job-declined",
    title_snapshot: "Fork seals",
    total_cents: 33_900,
    tax_cents: 3_900,
  },
  {
    job_id: "job-deferred",
    title_snapshot: "Tires",
    total_cents: 56_500,
    tax_cents: 6_500,
  },
];

const LINES = [
  {
    job_id: "job-brakes",
    kind: "labor",
    description: "Brake labour",
    extended_amount_cents: 12_000,
    position: 0,
  },
  {
    job_id: "job-brakes",
    kind: "part",
    description: "Brake pads",
    extended_amount_cents: 9_000,
    position: 1,
  },
  {
    job_id: "job-brakes",
    kind: "discount",
    description: "Loyalty discount",
    extended_amount_cents: -1_000,
    position: 2,
  },
  {
    job_id: "job-chain",
    kind: "labor",
    description: "Chain labour",
    extended_amount_cents: 20_000,
    position: 0,
  },
  {
    job_id: "job-chain",
    kind: "part",
    description: "Chain kit",
    extended_amount_cents: 20_000,
    position: 1,
  },
  {
    job_id: "job-declined",
    kind: "labor",
    description: "Fork labour",
    extended_amount_cents: 30_000,
    position: 0,
  },
];

const DECISIONS = [
  { job_id: "job-brakes", decision: "approved" },
  { job_id: "job-chain", decision: "approved" },
  { job_id: "job-declined", decision: "declined" },
  { job_id: "job-deferred", decision: "deferred" },
];

describe("buildSquareLinesFromConfirmedScope", () => {
  it("bills approved jobs only — declined and deferred are excluded", () => {
    const result = buildSquareLinesFromConfirmedScope({
      jobs: JOBS,
      lines: LINES,
      decisions: DECISIONS,
    });
    const names = result.lineItems.map((line) => line.name).join(" | ");
    expect(names).not.toContain("Fork");
    expect(names).not.toContain("Tires");
    expect(names).toContain("Brake labour");
    expect(names).toContain("Chain kit");
  });

  it("HST line equals the exact summed per-job tax cents", () => {
    const result = buildSquareLinesFromConfirmedScope({
      jobs: JOBS,
      lines: LINES,
      decisions: DECISIONS,
    });
    const hstLine = result.lineItems.find((line) => line.name === HST_LINE_NAME);
    expect(hstLine?.amountCents).toBe(2_600 + 5_198);
    expect(result.hstCents).toBe(2_600 + 5_198);
  });

  it("totals match the issued invoice totals exactly", () => {
    const result = buildSquareLinesFromConfirmedScope({
      jobs: JOBS,
      lines: LINES,
      decisions: DECISIONS,
    });
    // Invoice math from workflow_v2_issue_invoice over approved jobs:
    const invoiceSubtotal = 22_600 - 2_600 + (45_198 - 5_198);
    const invoiceTax = 2_600 + 5_198;
    expect(result.subtotalCents).toBe(invoiceSubtotal);
    expect(result.totalCents).toBe(invoiceSubtotal + invoiceTax);

    const lineSum = result.lineItems.reduce((sum, line) => sum + line.amountCents, 0);
    expect(lineSum).toBe(result.totalCents);
  });

  it("reconciles line drift with an adjustment so totals stay exact", () => {
    // job total says pre-tax 210_00 but detail lines only sum to 200_00.
    const result = buildSquareLinesFromConfirmedScope({
      jobs: [
        {
          job_id: "j1",
          title_snapshot: "Tune-up",
          total_cents: 23_730,
          tax_cents: 2_730,
        },
      ],
      lines: [
        {
          job_id: "j1",
          kind: "labor",
          description: "Labour",
          extended_amount_cents: 20_000,
          position: 0,
        },
      ],
      decisions: [{ job_id: "j1", decision: "approved" }],
    });
    const adjustment = result.lineItems.find((line) => line.name.includes("adjustment"));
    expect(adjustment?.amountCents).toBe(1_000);
    const lineSum = result.lineItems.reduce((sum, line) => sum + line.amountCents, 0);
    expect(lineSum).toBe(result.totalCents);
  });

  it("falls back to a single job line when no detail lines exist", () => {
    const result = buildSquareLinesFromConfirmedScope({
      jobs: [
        {
          job_id: "j1",
          title_snapshot: "Oil change",
          total_cents: 11_300,
          tax_cents: 1_300,
        },
      ],
      lines: [],
      decisions: [{ job_id: "j1", decision: "approved" }],
    });
    expect(result.lineItems).toEqual([
      { name: "Oil change", quantity: "1", amountCents: 10_000 },
      { name: HST_LINE_NAME, quantity: "1", amountCents: 1_300 },
    ]);
    expect(result.totalCents).toBe(11_300);
  });

  it("returns no lines when nothing is approved", () => {
    const result = buildSquareLinesFromConfirmedScope({
      jobs: JOBS,
      lines: LINES,
      decisions: DECISIONS.map((d) => ({ ...d, decision: "declined" })),
    });
    expect(result.lineItems).toHaveLength(0);
    expect(result.totalCents).toBe(0);
  });
});
