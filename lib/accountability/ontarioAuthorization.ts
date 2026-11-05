/** Basis points. 1000 = 10 percent, the ceiling in the Consumer Protection Act, 2002. */
export const STATUTORY_ESTIMATE_CEILING_BPS = 1000;

export type ChargeableStartInput = {
  priceCents: number;
  legacyApproved: boolean;
  jobApprovedOnConfirmedVersion: boolean;
  estimateDocumentExists: boolean;
  maximumAuthorizationCents: number | null;
  alreadyAuthorizedSpendCents: number;
  ceilingBps: number;
};

export type ChargeableStartDecision =
  | { ok: true }
  | {
      ok: false;
      reason: "NEEDS_SUPPLEMENTAL_ESTIMATE" | "EXCEEDS_AUTHORIZED_MAXIMUM" | "NEEDS_AUTHORIZATION";
    };

export function exceedsAuthorizedCeiling(
  authorizedCents: number,
  proposedCents: number,
  ceilingBps: number
): boolean {
  if (authorizedCents < 0 || proposedCents < 0) return true;
  const limit = Math.floor((authorizedCents * (10000 + ceilingBps)) / 10000);
  return proposedCents > limit;
}

export function chargeableStartDecision(
  input: ChargeableStartInput
): ChargeableStartDecision {
  if (input.priceCents <= 0) return { ok: true };
  if (input.jobApprovedOnConfirmedVersion) return { ok: true };

  if (input.maximumAuthorizationCents != null) {
    const proposed = input.alreadyAuthorizedSpendCents + input.priceCents;
    if (
      exceedsAuthorizedCeiling(
        input.maximumAuthorizationCents,
        proposed,
        input.ceilingBps
      )
    ) {
      return { ok: false, reason: "EXCEEDS_AUTHORIZED_MAXIMUM" };
    }
    return { ok: true };
  }

  if (input.estimateDocumentExists) {
    return { ok: false, reason: "NEEDS_SUPPLEMENTAL_ESTIMATE" };
  }

  if (input.legacyApproved) return { ok: true };
  return { ok: false, reason: "NEEDS_AUTHORIZATION" };
}

/**
 * An estimate fee is charged only when it was disclosed before the estimate
 * was prepared. When the customer proceeds with the repair, the fee is not
 * added to the invoice.
 */
export function estimateFeeCents(input: {
  feeCents: number;
  disclosed: boolean;
  repairProceeding: boolean;
}): number {
  if (input.feeCents <= 0 || !input.disclosed || input.repairProceeding) return 0;
  return input.feeCents;
}

export function warrantySnapshotText(input: {
  summary: string;
  exemptions: string;
}): string {
  return [
    input.summary.trim(),
    `Regulatory exemptions: ${input.exemptions.trim()}`,
    "Manufacturer warranty and any shop warranty are separate from this statutory coverage.",
  ].join(" ");
}
