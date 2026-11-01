"use server";

import { revalidatePath } from "next/cache";
import { toFormErrorMessage } from "@/lib/services/errors";
import { addLegalParameter } from "@/lib/services/legalParameters";
import { parseShopLocalDateTimeInput } from "@/lib/datetime/format";

export type LegalFormState = { error: string | null; saved: boolean };

export async function addLegalParameterAction(
  _previous: LegalFormState,
  formData: FormData
): Promise<LegalFormState> {
  try {
    const effectiveOn = String(formData.get("effective_on") ?? "").trim();
    const effective = effectiveOn
      ? parseShopLocalDateTimeInput(`${effectiveOn}T00:00`)?.toISOString()
      : null;
    if (!effective) {
      return { error: "Enter the date these rules take effect.", saved: false };
    }
    const ceiling = Number(formData.get("ceiling_bps"));
    if (!Number.isInteger(ceiling) || ceiling < 0 || ceiling > 10000) {
      return {
        error: "Enter the ceiling in basis points, from 0 to 10000.",
        saved: false,
      };
    }
    await addLegalParameter({
      effectiveAt: effective,
      sourceCitation: String(formData.get("source_citation") ?? ""),
      ceilingBps: ceiling,
      estimateFeeRule: String(formData.get("estimate_fee_rule") ?? ""),
      warrantySummary: String(formData.get("warranty_summary") ?? ""),
      warrantyExemptions: String(formData.get("warranty_exemptions") ?? ""),
    });
  } catch (error) {
    return { error: toFormErrorMessage(error), saved: false };
  }
  revalidatePath("/settings/legal");
  return { error: null, saved: true };
}
