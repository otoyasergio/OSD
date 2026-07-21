"use client";

import { useMemo, useState, useTransition } from "react";
import type { PortalEstimateView } from "@/lib/services/portal";
import { HST_PERCENT } from "@/lib/pricing/hst";
import { FormError } from "@/components/forms/Field";

type Decision = "approved" | "declined";

type Props = {
  estimate: PortalEstimateView;
  defaultSignerName: string;
  confirmAction: (payload: {
    decisions: Array<{ jobId: string; decision: Decision }>;
    expectedContentHash: string;
    signerName: string;
  }) => Promise<{ error: string | null }>;
};

function dollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function PortalEstimateDecision({
  estimate,
  defaultSignerName,
  confirmAction,
}: Props) {
  const [decisions, setDecisions] = useState<Record<string, Decision>>(() => {
    const initial: Record<string, Decision> = {};
    for (const job of estimate.jobs) {
      if (job.decision === "approved" || job.decision === "declined") {
        initial[job.job_id] = job.decision;
      }
    }
    return initial;
  });
  const [signerName, setSignerName] = useState(defaultSignerName);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(estimate.confirmed);
  const [pending, startTransition] = useTransition();

  const allDecided = estimate.jobs.every((job) => decisions[job.job_id]);

  const acceptedTotals = useMemo(() => {
    let subtotal = 0;
    let tax = 0;
    for (const job of estimate.jobs) {
      if (decisions[job.job_id] !== "approved") continue;
      subtotal += job.total_cents - job.tax_cents;
      tax += job.tax_cents;
    }
    return { subtotal, tax, total: subtotal + tax };
  }, [decisions, estimate.jobs]);

  if (done || estimate.confirmed) {
    return (
      <section className="rounded-lg bg-white p-6 shadow-sm">
        <h2 className="mb-2 text-lg font-semibold">Estimate confirmed</h2>
        <p className="mb-4 text-sm text-zinc-600">
          Your decisions are recorded. The shop will proceed with the approved work only.
        </p>
        <ul className="divide-y divide-zinc-100 text-sm">
          {estimate.jobs.map((job) => (
            <li key={job.job_id} className="flex justify-between gap-3 py-2">
              <span>{job.title}</span>
              <span
                className={
                  (decisions[job.job_id] ?? job.decision) === "approved"
                    ? "font-semibold text-emerald-700"
                    : "font-semibold text-zinc-500"
                }
              >
                {(decisions[job.job_id] ?? job.decision) === "approved"
                  ? `Approved · ${dollars(job.total_cents)}`
                  : "Declined"}
              </span>
            </li>
          ))}
        </ul>
      </section>
    );
  }

  return (
    <section className="rounded-lg bg-white p-6 shadow-sm">
      <h2 className="mb-1 text-lg font-semibold">Review your estimate</h2>
      <p className="mb-4 text-sm text-zinc-600">
        Choose approve or decline for each item, then confirm once. Only approved work
        will be performed and billed.
      </p>

      <div className="flex flex-col gap-4">
        {estimate.jobs.map((job) => {
          const current = decisions[job.job_id];
          return (
            <fieldset key={job.job_id} className="rounded border border-zinc-200 p-4">
              <legend className="px-1 text-sm font-semibold">{job.title}</legend>
              <div className="mb-3 flex flex-wrap justify-between gap-2 text-sm text-zinc-700">
                <span>
                  {job.pricing_mode === "fixed_package"
                    ? "Package price"
                    : "Parts and labour"}
                </span>
                <span className="font-semibold">{dollars(job.total_cents)}</span>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  className={`min-h-11 flex-1 rounded border px-3 text-sm font-semibold ${
                    current === "approved"
                      ? "border-emerald-600 bg-emerald-600 text-white"
                      : "border-zinc-300 bg-white text-zinc-800"
                  }`}
                  aria-pressed={current === "approved"}
                  disabled={pending}
                  onClick={() =>
                    setDecisions((prev) => ({ ...prev, [job.job_id]: "approved" }))
                  }
                >
                  Approve
                </button>
                <button
                  type="button"
                  className={`min-h-11 flex-1 rounded border px-3 text-sm font-semibold ${
                    current === "declined"
                      ? "border-zinc-700 bg-zinc-700 text-white"
                      : "border-zinc-300 bg-white text-zinc-800"
                  }`}
                  aria-pressed={current === "declined"}
                  disabled={pending}
                  onClick={() =>
                    setDecisions((prev) => ({ ...prev, [job.job_id]: "declined" }))
                  }
                >
                  Decline
                </button>
              </div>
            </fieldset>
          );
        })}
      </div>

      <div className="mt-4 space-y-1 text-right text-sm">
        <p>Approved subtotal: {dollars(acceptedTotals.subtotal)}</p>
        <p>
          HST ({HST_PERCENT}%): {dollars(acceptedTotals.tax)}
        </p>
        <p className="text-base font-semibold">
          Total if confirmed: {dollars(acceptedTotals.total)}
        </p>
      </div>

      <label className="mt-4 block">
        <span className="field-label">Full name</span>
        <input
          type="text"
          required
          className="min-h-11 w-full rounded border border-zinc-300 px-3"
          value={signerName}
          onChange={(event) => setSignerName(event.target.value)}
          autoComplete="name"
        />
      </label>

      {error ? <FormError message={error} /> : null}

      <button
        type="button"
        className="btn btn-primary mt-4 min-h-12 w-full text-base"
        disabled={pending || !allDecided || !signerName.trim()}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            const result = await confirmAction({
              decisions: estimate.jobs.map((job) => ({
                jobId: job.job_id,
                decision: decisions[job.job_id],
              })),
              expectedContentHash: estimate.content_hash,
              signerName: signerName.trim(),
            });
            if (result.error) {
              setError(result.error);
              return;
            }
            setDone(true);
          })
        }
      >
        {pending
          ? "Confirming…"
          : allDecided
            ? "Confirm my decisions"
            : "Choose approve or decline for every item"}
      </button>
    </section>
  );
}
