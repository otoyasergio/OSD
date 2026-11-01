import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/database/supabase-server";
import type { DbClient } from "@/lib/database/types";
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

/**
 * The rule row in force right now. Callers pass the client that matches
 * their actor: portal confirmations run without a staff session and must use
 * the admin client.
 */
export async function currentLegalParameter(
  client: DbClient
): Promise<LegalParameter | null> {
  const { data, error } = await client
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

/** Copy the rule in force onto a presented estimate version. Unmigrated columns are ignored. */
export async function stampPresentedEstimateVersion(
  client: DbClient,
  estimateVersionId: string
): Promise<void> {
  const parameter = await currentLegalParameter(client);
  if (!parameter) return;
  const { error } = await client
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

/**
 * Record which rule row governs a work order. When the agreement is a
 * presented estimate version, the row stamped on that version wins, so a rule
 * added between presenting and confirming does not change the agreement.
 * Without a version (a recorded maximum), the row in force now applies.
 */
export async function applyLegalParameterToWorkOrder(
  client: DbClient,
  workOrderId: string,
  options: { estimateVersionId?: string | null } = {}
): Promise<void> {
  let parameterId: string | null = null;
  if (options.estimateVersionId) {
    const { data, error } = await client
      .from("estimate_version")
      .select("legal_parameter_id")
      .eq("estimate_version_id", options.estimateVersionId)
      .maybeSingle();
    if (error && !isUndefinedColumnError(error, "legal_parameter_id")) throw error;
    parameterId =
      (data as { legal_parameter_id?: string | null } | null)?.legal_parameter_id ?? null;
  }
  if (!parameterId) {
    parameterId = (await currentLegalParameter(client))?.legal_parameter_id ?? null;
  }
  if (!parameterId) return;
  const { error } = await client
    .from("work_order")
    .update({ applied_legal_parameter_id: parameterId })
    .eq("work_order_id", workOrderId);
  if (error && !isUndefinedColumnError(error, "applied_legal_parameter_id")) throw error;
}
