import { appendHstLine, HST_LINE_NAME, hstAmount, roundMoney } from "@/lib/pricing/hst";

export type BillableLine = { name: string; amount: number };

export type ConfirmedAgreement = {
  /** Approved pre-tax lines from the confirmed estimate version. */
  preTaxLines: Array<{ name: string; amountCents: number }>;
  /** HST captured on that version, never recomputed. */
  hstCents: number;
};

/**
 * A confirmed estimate version is the customer agreement and bills with the
 * HST captured on that version. Work that started afterwards under a recorded
 * maximum authorization is not on the version, so it is billed from its live
 * price with HST computed on it. The estimate fee is added only when nothing
 * chargeable is on the bill. Legacy job snapshots are used only when no
 * confirmed version exists.
 */
export function linesFromConfirmedAgreement(input: {
  confirmed: ConfirmedAgreement | null;
  addedWorkPreTax: BillableLine[];
  estimateFeeCents: number;
  legacyPreTax: BillableLine[];
}): BillableLine[] {
  if (!input.confirmed) {
    if (input.estimateFeeCents > 0) {
      return appendHstLine([
        { name: "Estimate fee", amount: input.estimateFeeCents / 100 },
      ]);
    }
    return appendHstLine(input.legacyPreTax);
  }

  const versionLines: BillableLine[] = input.confirmed.preTaxLines
    .filter((line) => line.amountCents !== 0)
    .map((line) => ({ name: line.name, amount: Math.round(line.amountCents) / 100 }));
  const liveLines = input.addedWorkPreTax.filter((line) => line.amount !== 0);
  const repairOnTheBill = [...versionLines, ...liveLines].some((line) => line.amount > 0);
  if (!repairOnTheBill && input.estimateFeeCents > 0) {
    liveLines.push({ name: "Estimate fee", amount: input.estimateFeeCents / 100 });
  }

  const liveSubtotal = liveLines.reduce((sum, line) => sum + line.amount, 0);
  const hst = roundMoney(input.confirmed.hstCents / 100 + hstAmount(liveSubtotal));
  const lines = [...versionLines, ...liveLines];
  if (hst > 0) lines.push({ name: HST_LINE_NAME, amount: hst });
  return lines;
}
