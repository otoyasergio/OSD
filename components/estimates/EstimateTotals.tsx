"use client";

import type { EstimateTotals as EstimateTotalsValue } from "@/lib/jobs-v2/pricing";
import { HST_PERCENT } from "@/lib/pricing/hst";
import { formatCents } from "@/components/estimates/workspaceModel";

/**
 * Estimate totals summary. Values come from buildEstimateVersionSnapshot's
 * underlying pricing functions (priceJob/totalEstimate) so the screen always
 * matches what presentation freezes.
 */
export function EstimateTotals({ totals }: { totals: EstimateTotalsValue }) {
  return (
    <div className="rounded border border-[var(--border)] bg-[var(--surface-muted)] p-3 text-sm">
      <div className="flex justify-between text-[var(--status-neutral)]">
        <span>Subtotal</span>
        <span>{formatCents(totals.subtotalCents)}</span>
      </div>
      {totals.discountCents > 0 ? (
        <div className="flex justify-between text-[var(--status-neutral)]">
          <span>Discounts applied</span>
          <span>−{formatCents(totals.discountCents)}</span>
        </div>
      ) : null}
      <div className="flex justify-between text-[var(--status-neutral)]">
        <span>HST ({HST_PERCENT}%)</span>
        <span>{formatCents(totals.taxCents)}</span>
      </div>
      <div className="mt-1 flex justify-between border-t border-[var(--border)] pt-1 text-base font-semibold text-[var(--foreground)]">
        <span>Estimate total</span>
        <span>{formatCents(totals.totalCents)}</span>
      </div>
      {totals.missingPriceCount > 0 ? (
        <p className="mt-2 text-xs font-medium text-amber-800">
          {totals.missingPriceCount} price{totals.missingPriceCount === 1 ? "" : "s"}{" "}
          missing — set part retail prices on the Parts tab before presenting.
        </p>
      ) : null}
    </div>
  );
}
