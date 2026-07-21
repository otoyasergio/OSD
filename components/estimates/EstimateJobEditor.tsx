"use client";

import type { JobPricingBreakdown } from "@/lib/jobs-v2/pricing";
import type { JobPricingMode } from "@/lib/database/types";
import { StageChip } from "@/components/ui/StageChip";
import { SELECT_CLASS } from "@/components/forms/Field";
import {
  authorizationChip,
  formatCents,
  workProgressChip,
  type JobPartsRollup,
  type JobPricingFormState,
  type WorkspaceJob,
} from "@/components/estimates/workspaceModel";
import type { AuthorizationDecision } from "@/lib/database/types";

const INPUT_CLASS =
  "min-h-11 w-full rounded border border-[var(--border-strong)] bg-white px-3 py-2 text-base text-[var(--foreground)] outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-ring)]";

const MODE_OPTIONS: Array<{ value: JobPricingMode; label: string }> = [
  { value: "itemized", label: "Itemized (labour + parts)" },
  { value: "fixed_package", label: "Fixed package price" },
  { value: "no_charge", label: "No charge" },
];

/**
 * One job row on the estimate: authorization + work-progress chips, labour /
 * fee / discount inputs (dollars → integer cents), read-only parts rollup,
 * and the pricing-mode selector. Parts are priced on the Parts tab only.
 */
export function EstimateJobEditor({
  job,
  partsRollup,
  state,
  breakdown,
  liveDecision,
  onPresentedVersion,
  disabled,
  lockedNote = null,
  onChange,
}: {
  job: WorkspaceJob;
  partsRollup: JobPartsRollup;
  state: JobPricingFormState;
  breakdown: JobPricingBreakdown;
  liveDecision: AuthorizationDecision | null | undefined;
  onPresentedVersion: boolean;
  disabled: boolean;
  lockedNote?: string | null;
  onChange: (next: JobPricingFormState) => void;
}) {
  const auth = authorizationChip(job.status, liveDecision, onPresentedVersion);
  const progress = workProgressChip(job.status);
  const isPackage = state.mode === "fixed_package";
  const isNoCharge = state.mode === "no_charge";

  return (
    <article className="card card-body">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h4 className="text-base font-semibold text-[var(--foreground)]">
            {job.title}
          </h4>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <StageChip label={auth.label} tone={auth.tone} />
            <StageChip label={progress.label} tone={progress.tone} />
            <span className="text-sm text-[var(--status-neutral)]">
              {job.assigned_technician_name ?? "Unassigned"}
            </span>
          </div>
        </div>
        <div className="text-right">
          <p className="text-sm text-[var(--status-neutral)]">Job total (incl. HST)</p>
          <p className="text-lg font-semibold text-[var(--foreground)]">
            {formatCents(breakdown.totalCents)}
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="block">
          <span className="field-label">Pricing mode</span>
          <select
            className={SELECT_CLASS}
            value={state.mode}
            disabled={disabled}
            onChange={(event) =>
              onChange({ ...state, mode: event.target.value as JobPricingMode })
            }
          >
            {MODE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        {isPackage ? (
          <label className="block">
            <span className="field-label">Package price (CAD)</span>
            <input
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              className={INPUT_CLASS}
              value={state.packageText}
              disabled={disabled}
              placeholder="Required"
              onChange={(event) =>
                onChange({ ...state, packageText: event.target.value })
              }
            />
          </label>
        ) : (
          <label className="block">
            <span className="field-label">Labour (CAD)</span>
            <input
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              className={INPUT_CLASS}
              value={state.labourText}
              disabled={disabled || isNoCharge}
              onChange={(event) => onChange({ ...state, labourText: event.target.value })}
            />
          </label>
        )}

        <label className="block">
          <span className="field-label">Fee (CAD)</span>
          <input
            type="number"
            min="0"
            step="0.01"
            inputMode="decimal"
            className={INPUT_CLASS}
            value={state.feeText}
            disabled={disabled || isNoCharge}
            placeholder="0.00"
            onChange={(event) => onChange({ ...state, feeText: event.target.value })}
          />
        </label>

        <label className="block">
          <span className="field-label">Discount (CAD)</span>
          <input
            type="number"
            min="0"
            step="0.01"
            inputMode="decimal"
            className={INPUT_CLASS}
            value={state.discountText}
            disabled={disabled || isNoCharge}
            placeholder="0.00"
            onChange={(event) => onChange({ ...state, discountText: event.target.value })}
          />
        </label>
      </div>

      <p className="mt-3 text-sm text-[var(--status-neutral)]">
        Parts (from Parts tab):{" "}
        {partsRollup.count === 0 ? (
          "none added"
        ) : (
          <>
            {partsRollup.count} × {formatCents(partsRollup.knownTotalCents)}
            {partsRollup.missingPriceCount > 0 ? (
              <span className="font-medium text-amber-800">
                {" "}
                · {partsRollup.missingPriceCount} missing price
                {partsRollup.missingPriceCount === 1 ? "" : "s"}
              </span>
            ) : null}
            {isPackage ? " · included in package" : null}
          </>
        )}
      </p>

      {isNoCharge ? (
        <p className="mt-1 text-xs text-[var(--status-neutral)]">
          No-charge work stays visible on the estimate at $0.
        </p>
      ) : null}

      {lockedNote ? (
        <p className="mt-1 text-xs text-[var(--status-neutral)]">{lockedNote}</p>
      ) : null}
    </article>
  );
}
