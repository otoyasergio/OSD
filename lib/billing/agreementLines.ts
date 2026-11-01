import { appendHstLine } from "@/lib/pricing/hst";

export type BillableLine = { name: string; amount: number };

/**
 * A confirmed estimate version is the customer agreement. Its lines already
 * include the HST captured on that version. The estimate fee is added only
 * when that version has no chargeable work. Legacy job snapshots are used
 * only when no confirmed version exists.
 */
export function linesFromConfirmedAgreement(input: {
  confirmedLines: Array<{ name: string; amountCents: number }> | null;
  estimateFeeCents: number;
  legacyPreTax: BillableLine[];
}): BillableLine[] {
  if (input.confirmedLines) {
    const lines = input.confirmedLines
      .filter((line) => line.amountCents !== 0)
      .map((line) => ({
        name: line.name,
        amount: Math.round(line.amountCents) / 100,
      }));
    const repairOnTheBill = lines.some((line) => line.amount > 0);
    if (input.estimateFeeCents > 0 && !repairOnTheBill) {
      lines.push(
        ...appendHstLine([{ name: "Estimate fee", amount: input.estimateFeeCents / 100 }])
      );
    }
    return lines;
  }
  if (input.estimateFeeCents > 0) {
    return appendHstLine([
      { name: "Estimate fee", amount: input.estimateFeeCents / 100 },
    ]);
  }
  return appendHstLine(input.legacyPreTax);
}
