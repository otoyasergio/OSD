"use client";

import { useState, useTransition } from "react";
import {
  cancelSquareInvoiceAction,
  publishSquareBalanceAction,
  publishSquareInvoiceAction,
  sendEstimateApprovalAction,
  syncSquareDraftAction,
} from "@/app/(app)/work_orders/square-actions";
import type { BillingAmountMode, BillingStage } from "@/lib/billing/stages";
import { FormError } from "@/components/forms/Field";

type Props = {
  workOrderId: string;
  squareInvoiceId: string | null;
  squarePaymentStatus: string | null;
  squareInvoicePublicUrl: string | null;
  billingStage: BillingStage | string;
  billingCollectedCents: number;
  estimateTotalCents: number;
  canManage: boolean;
  readOnly?: boolean;
};

const STAGE_LABELS: Record<string, string> = {
  none: "No estimate yet",
  draft: "Draft estimate",
  awaiting_approval: "Awaiting approval",
  ready_to_invoice: "Ready to invoice",
  invoiced: "Invoice sent",
  paid: "Paid",
};

export function SquareInvoicePanel({
  workOrderId,
  squareInvoiceId,
  squarePaymentStatus,
  squareInvoicePublicUrl,
  billingStage,
  billingCollectedCents,
  estimateTotalCents,
  canManage,
  readOnly = false,
}: Props) {
  const [publicUrl, setPublicUrl] = useState<string | null>(squareInvoicePublicUrl);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<BillingAmountMode>("full");
  const [depositPercent, setDepositPercent] = useState("50");
  const [customDollars, setCustomDollars] = useState("");
  const [pending, startTransition] = useTransition();

  const stage = billingStage || "none";
  const remainingCents = Math.max(0, estimateTotalCents - billingCollectedCents);
  const isPublished =
    stage === "invoiced" ||
    squarePaymentStatus === "unpaid" ||
    squarePaymentStatus === "partially_paid";
  const canSyncDraft =
    stage === "none" ||
    stage === "draft" ||
    stage === "awaiting_approval" ||
    stage === "ready_to_invoice";
  const canPublish =
    (stage === "ready_to_invoice" ||
      stage === "draft" ||
      stage === "awaiting_approval") &&
    remainingCents > 0;
  const canPublishBalance =
    billingCollectedCents > 0 &&
    remainingCents > 0 &&
    (stage === "ready_to_invoice" || stage === "paid" || squarePaymentStatus === "paid");
  const canCancel =
    Boolean(squareInvoiceId) &&
    (squarePaymentStatus === "unpaid" ||
      squarePaymentStatus === "draft" ||
      squarePaymentStatus === "cancelled" ||
      !squarePaymentStatus);

  if (readOnly || !canManage) {
    return squareInvoiceId ? (
      <p className="text-sm text-[var(--status-neutral)]">
        Billing: {STAGE_LABELS[stage] ?? stage}
        {squarePaymentStatus ? ` · ${squarePaymentStatus}` : ""}
      </p>
    ) : null;
  }

  function run(
    action: () => Promise<{ error: string | null; publicUrl?: string | null }>
  ) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (result.error) {
        setError(result.error);
        return;
      }
      if (result.publicUrl) setPublicUrl(result.publicUrl);
    });
  }

  return (
    <div className="card card-pad flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-[var(--status-neutral)]">
          Billing
        </h3>
        <span className="rounded bg-[var(--surface-muted)] px-2 py-0.5 text-xs font-medium text-foreground">
          {STAGE_LABELS[stage] ?? stage}
        </span>
      </div>

      <div className="text-sm text-foreground">
        <p>
          Estimate total: <strong>${(estimateTotalCents / 100).toFixed(2)}</strong>
        </p>
        <p>
          Collected: <strong>${(billingCollectedCents / 100).toFixed(2)}</strong>
          {" · "}
          Remaining: <strong>${(remainingCents / 100).toFixed(2)}</strong>
        </p>
        {squareInvoiceId ? (
          <p className="mt-1 text-xs text-[var(--status-neutral)]">
            Active Square invoice: <code>{squareInvoiceId}</code>
            {squarePaymentStatus ? ` · ${squarePaymentStatus}` : ""}
          </p>
        ) : null}
      </div>

      {(publicUrl || squareInvoicePublicUrl) && isPublished ? (
        <a
          href={publicUrl || squareInvoicePublicUrl || "#"}
          target="_blank"
          rel="noreferrer"
          className="btn btn-primary self-start"
        >
          Open payment link
        </a>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {canSyncDraft ? (
          <button
            type="button"
            className="btn btn-secondary"
            disabled={pending}
            onClick={() => run(() => syncSquareDraftAction(workOrderId))}
          >
            {pending ? "Working…" : "Sync draft"}
          </button>
        ) : null}

        <button
          type="button"
          className="btn btn-secondary"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              setError(null);
              const result = await sendEstimateApprovalAction(workOrderId, "email");
              if (result.error) setError(result.error);
            })
          }
        >
          Send for approval
        </button>
      </div>

      {canPublish ? (
        <div className="flex flex-col gap-2 rounded border border-[var(--border)] p-3">
          <p className="text-xs font-medium uppercase tracking-wide text-[var(--status-neutral)]">
            Publish for payment
          </p>
          <label className="flex flex-col gap-1 text-sm">
            Amount
            <select
              className="min-h-11 rounded border border-[var(--border-strong)] px-3"
              value={mode}
              onChange={(e) => setMode(e.target.value as BillingAmountMode)}
            >
              <option value="full">Full remaining</option>
              <option value="deposit_percent">Deposit %</option>
              <option value="custom">Custom amount</option>
            </select>
          </label>
          {mode === "deposit_percent" ? (
            <label className="flex flex-col gap-1 text-sm">
              Percent
              <input
                type="number"
                min={1}
                max={100}
                className="min-h-11 rounded border border-[var(--border-strong)] px-3"
                value={depositPercent}
                onChange={(e) => setDepositPercent(e.target.value)}
              />
            </label>
          ) : null}
          {mode === "custom" ? (
            <label className="flex flex-col gap-1 text-sm">
              Amount (CAD)
              <input
                type="number"
                min={0.01}
                step={0.01}
                className="min-h-11 rounded border border-[var(--border-strong)] px-3"
                value={customDollars}
                onChange={(e) => setCustomDollars(e.target.value)}
              />
            </label>
          ) : null}
          <button
            type="button"
            className="btn btn-primary self-start"
            disabled={pending}
            onClick={() =>
              run(() =>
                publishSquareInvoiceAction(workOrderId, {
                  mode,
                  depositPercent:
                    mode === "deposit_percent" ? Number(depositPercent) : undefined,
                  customCents:
                    mode === "custom"
                      ? Math.round(Number(customDollars || 0) * 100)
                      : undefined,
                })
              )
            }
          >
            {pending ? "Publishing…" : "Publish invoice"}
          </button>
        </div>
      ) : null}

      {canPublishBalance ? (
        <button
          type="button"
          className="btn btn-primary self-start"
          disabled={pending}
          onClick={() => run(() => publishSquareBalanceAction(workOrderId))}
        >
          {pending ? "Publishing…" : "Publish balance"}
        </button>
      ) : null}

      {canCancel ? (
        <button
          type="button"
          className="btn btn-secondary self-start"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              setError(null);
              const result = await cancelSquareInvoiceAction(workOrderId);
              if (result.error) setError(result.error);
              else setPublicUrl(null);
            })
          }
        >
          Cancel &amp; recreate
        </button>
      ) : null}

      {error ? <FormError message={error} /> : null}
    </div>
  );
}
