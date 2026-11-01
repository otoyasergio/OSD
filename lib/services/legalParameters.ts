import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/database/supabase-server";
import { canManageLegalParameters } from "@/lib/permissions";
import { warrantySnapshotText } from "@/lib/accountability/ontarioAuthorization";
import {
  isUndefinedColumnError,
  isUndefinedTableError,
} from "@/lib/database/schemaCompat";

export type LegalParameter = {
  legal_parameter_id: string;
  effective_at: string;
  source_citation: string;
  ceiling_bps: number;
  estimate_fee_rule: string;
  warranty_summary: string;
  warranty_exemptions: string;
};

const COLUMNS =
  "legal_parameter_id, effective_at, source_citation, ceiling_bps, estimate_fee_rule, warranty_summary, warranty_exemptions";

export async function listLegalParameters(): Promise<LegalParameter[]> {
  const user = await requireUser();
  if (!canManageLegalParameters(user.role)) throw new Error("FORBIDDEN");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("legal_parameter")
    .select(COLUMNS)
    .order("effective_at", { ascending: false });
  if (error) {
    if (isUndefinedTableError(error, "legal_parameter")) return [];
    throw error;
  }
  return (data ?? []) as LegalParameter[];
}

export async function currentLegalParameter(): Promise<LegalParameter | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("legal_parameter")
    .select(COLUMNS)
    .lte("effective_at", new Date().toISOString())
    .order("effective_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    if (isUndefinedTableError(error, "legal_parameter")) return null;
    throw error;
  }
  return (data as LegalParameter | null) ?? null;
}

export async function addLegalParameter(input: {
  effectiveAt: string;
  sourceCitation: string;
  ceilingBps: number;
  estimateFeeRule: string;
  warrantySummary: string;
  warrantyExemptions: string;
}): Promise<void> {
  const user = await requireUser();
  if (!canManageLegalParameters(user.role)) throw new Error("FORBIDDEN");
  const supabase = await createClient();
  const { error } = await supabase.from("legal_parameter").insert({
    effective_at: input.effectiveAt,
    source_citation: input.sourceCitation.trim(),
    ceiling_bps: input.ceilingBps,
    estimate_fee_rule: input.estimateFeeRule.trim(),
    warranty_summary: input.warrantySummary.trim(),
    warranty_exemptions: input.warrantyExemptions.trim(),
    created_by_user_id: user.user_id,
  });
  if (error) throw error;
}

/** Copy the rule in force onto a presented estimate version. Failures on an unmigrated database are ignored. */
export async function stampPresentedEstimateVersion(
  estimateVersionId: string
): Promise<void> {
  const parameter = await currentLegalParameter();
  if (!parameter) return;
  const supabase = await createClient();
  const { error } = await supabase
    .from("estimate_version")
    .update({
      legal_parameter_id: parameter.legal_parameter_id,
      ceiling_bps: parameter.ceiling_bps,
      warranty_snapshot: warrantySnapshotText({
        summary: parameter.warranty_summary,
        exemptions: parameter.warranty_exemptions,
      }),
    })
    .eq("estimate_version_id", estimateVersionId);
  if (
    error &&
    !isUndefinedColumnError(error, "warranty_snapshot") &&
    !isUndefinedColumnError(error, "legal_parameter_id")
  ) {
    throw error;
  }
}

export async function applyLegalParameterToWorkOrder(workOrderId: string): Promise<void> {
  const parameter = await currentLegalParameter();
  if (!parameter) return;
  const supabase = await createClient();
  const { error } = await supabase
    .from("work_order")
    .update({ applied_legal_parameter_id: parameter.legal_parameter_id })
    .eq("work_order_id", workOrderId);
  if (error && !isUndefinedColumnError(error, "applied_legal_parameter_id")) throw error;
}
