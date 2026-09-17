import { HST_RATE } from "@/lib/pricing/hst";
import type { JobPricingMode } from "@/lib/database/types";
import type { MoneyCents } from "@/lib/jobs-v2/types";

/**
 * Deterministic integer-cents job pricing.
 *
 * - itemized: billable labour + parts + fees − discounts.
 * - fixed_package: the package price charges once; included components
 *   contribute $0; extras outside the package still bill.
 * - no_charge: always $0 (operational lines remain visible).
 *
 * Tax is computed per job (round-half-up on the job's taxable subtotal) and
 * summed at the estimate level so every job card, the estimate total, and
 * the Square line for HST agree to the cent.
 */

export type LaborLineInput = {
  amountCents: MoneyCents;
  billable: boolean;
  includedInPackage: boolean;
};

export type PartLineInput = {
  quantity: number;
  sellPriceCents: MoneyCents | null;
  includedInPackage: boolean;
};

export type FeeLineInput = {
  amountCents: MoneyCents;
  includedInPackage?: boolean;
};

export type DiscountLineInput = {
  /** Positive number of cents to subtract. */
  amountCents: MoneyCents;
};

export type JobPricingInput = {
  pricingMode: JobPricingMode;
  fixedPackagePriceCents: MoneyCents | null;
  laborLines: LaborLineInput[];
  partLines: PartLineInput[];
  feeLines: FeeLineInput[];
  discountLines: DiscountLineInput[];
  taxRateBps?: number;
};

export type JobPricingBreakdown = {
  laborCents: MoneyCents;
  partsCents: MoneyCents;
  feesCents: MoneyCents;
  packageCents: MoneyCents;
  discountCents: MoneyCents;
  subtotalCents: MoneyCents;
  taxCents: MoneyCents;
  totalCents: MoneyCents;
  /** Part lines missing a sell price — presentation must be blocked. */
  missingPriceCount: number;
};

export const DEFAULT_TAX_RATE_BPS = Math.round(HST_RATE * 10_000);

function assertIntegerCents(value: number, label: string): void {
  if (!Number.isInteger(value)) {
    throw new Error(`NON_INTEGER_CENTS:${label}`);
  }
}

export function partLineExtendedCents(line: PartLineInput): MoneyCents {
  if (line.sellPriceCents === null) return 0;
  assertIntegerCents(line.sellPriceCents, "part.sellPriceCents");
  return Math.round(line.quantity * line.sellPriceCents);
}

export function taxCentsOn(subtotalCents: MoneyCents, taxRateBps: number): MoneyCents {
  if (subtotalCents <= 0) return 0;
  return Math.round((subtotalCents * taxRateBps) / 10_000);
}

export function priceJob(input: JobPricingInput): JobPricingBreakdown {
  const taxRateBps = input.taxRateBps ?? DEFAULT_TAX_RATE_BPS;
  const isPackage = input.pricingMode === "fixed_package";
  const isNoCharge = input.pricingMode === "no_charge";

  let missingPriceCount = 0;

  let laborCents = 0;
  for (const line of input.laborLines) {
    assertIntegerCents(line.amountCents, "labor.amountCents");
    if (!line.billable) continue;
    if (isPackage && line.includedInPackage) continue;
    laborCents += line.amountCents;
  }

  let partsCents = 0;
  for (const line of input.partLines) {
    if (line.sellPriceCents === null) missingPriceCount += 1;
    if (isPackage && line.includedInPackage) continue;
    partsCents += partLineExtendedCents(line);
  }

  let feesCents = 0;
  for (const line of input.feeLines) {
    assertIntegerCents(line.amountCents, "fee.amountCents");
    if (isPackage && line.includedInPackage) continue;
    feesCents += line.amountCents;
  }

  let discountCents = 0;
  for (const line of input.discountLines) {
    assertIntegerCents(line.amountCents, "discount.amountCents");
    if (line.amountCents < 0) throw new Error("NEGATIVE_DISCOUNT_INPUT");
    discountCents += line.amountCents;
  }

  const packageCents =
    isPackage && input.fixedPackagePriceCents !== null ? input.fixedPackagePriceCents : 0;
  if (isPackage && input.fixedPackagePriceCents === null) {
    missingPriceCount += 1;
  }

  if (isNoCharge) {
    return {
      laborCents: 0,
      partsCents: 0,
      feesCents: 0,
      packageCents: 0,
      discountCents: 0,
      subtotalCents: 0,
      taxCents: 0,
      totalCents: 0,
      missingPriceCount,
    };
  }

  const gross = packageCents + laborCents + partsCents + feesCents;
  const subtotalCents = Math.max(0, gross - discountCents);
  const taxCents = taxCentsOn(subtotalCents, taxRateBps);

  return {
    laborCents,
    partsCents,
    feesCents,
    packageCents,
    discountCents: Math.min(discountCents, gross),
    subtotalCents,
    taxCents,
    totalCents: subtotalCents + taxCents,
    missingPriceCount,
  };
}

export type EstimateTotals = {
  subtotalCents: MoneyCents;
  discountCents: MoneyCents;
  taxCents: MoneyCents;
  totalCents: MoneyCents;
  missingPriceCount: number;
};

/** Estimate totals = sum of per-job breakdowns (tax rounds per job). */
export function totalEstimate(jobs: JobPricingBreakdown[]): EstimateTotals {
  let subtotalCents = 0;
  let discountCents = 0;
  let taxCents = 0;
  let missingPriceCount = 0;
  for (const job of jobs) {
    subtotalCents += job.subtotalCents;
    discountCents += job.discountCents;
    taxCents += job.taxCents;
    missingPriceCount += job.missingPriceCount;
  }
  return {
    subtotalCents,
    discountCents,
    taxCents,
    totalCents: subtotalCents + taxCents,
    missingPriceCount,
  };
}
