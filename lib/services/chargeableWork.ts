import type { DbClient } from "@/lib/database/types";
import {
  chargeableStartDecision,
  STATUTORY_ESTIMATE_CEILING_BPS,
} from "@/lib/accountability/ontarioAuthorization";
import {
  isUndefinedColumnError,
  isUndefinedTableError,
} from "@/lib/database/schemaCompat";

const LEGACY_APPROVED = new Set([
  "approved",
  "ready_to_start",
  "waiting_for_parts",
  "in_progress",
]);

function dollarsToCents(amount: number | null | undefined): number {
  if (amount == null || !Number.isFinite(Number(amount))) return 0;
  return Math.round(Number(amount) * 100);
}

/**
 * Chargeable work starts from a confirmed estimate line, a recorded maximum,
 * or a legacy approval on a visit that has no estimate document yet.
 * A presented or confirmed estimate makes that document the agreement.
 */
export async function assertChargeableJobMayStart(
  supabase: DbClient,
  jobId: string
): Promise<void> {
  const { data: job, error: jobError } = await supabase
    .from("job")
    .select("job_id, work_order_id, status, standard_price_snapshot")
    .eq("job_id", jobId)
    .maybeSingle();
  if (jobError) throw jobError;
  if (!job) throw new Error("JOB_NOT_FOUND");

  const priceCents = dollarsToCents(job.standard_price_snapshot as number | null);
  if (priceCents <= 0) return;

  const { data: workOrder, error: woError } = await supabase
    .from("work_order")
    .select("work_order_id, maximum_authorization_cents")
    .eq("work_order_id", job.work_order_id)
    .maybeSingle();
  if (woError) {
    if (isUndefinedColumnError(woError, "maximum_authorization_cents")) return;
    throw woError;
  }

  const { data: estimates, error: estimateError } = await supabase
    .from("estimate")
    .select("estimate_id, status, current_version_id")
    .eq("work_order_id", job.work_order_id)
    .in("status", ["presented", "confirmed"]);
  if (estimateError) {
    if (isUndefinedTableError(estimateError, "estimate")) return;
    throw estimateError;
  }

  const estimateDocumentExists = (estimates ?? []).length > 0;
  const confirmed = (estimates ?? []).find((row) => row.status === "confirmed");
  let jobApprovedOnConfirmedVersion = false;
  if (confirmed?.current_version_id) {
    const { data: decision, error: decisionError } = await supabase
      .from("estimate_job_decision")
      .select("decision")
      .eq("estimate_version_id", confirmed.current_version_id)
      .eq("job_id", jobId)
      .maybeSingle();
    if (decisionError && !isUndefinedTableError(decisionError, "estimate_job_decision")) {
      throw decisionError;
    }
    jobApprovedOnConfirmedVersion = decision?.decision === "approved";
  }

  let ceilingBps = STATUTORY_ESTIMATE_CEILING_BPS;
  if (confirmed?.current_version_id) {
    const { data: version, error: versionError } = await supabase
      .from("estimate_version")
      .select("ceiling_bps")
      .eq("estimate_version_id", confirmed.current_version_id)
      .maybeSingle();
    if (versionError && !isUndefinedColumnError(versionError, "ceiling_bps")) throw versionError;
    if (version?.ceiling_bps != null) ceilingBps = Number(version.ceiling_bps);
  }

  const { data: siblings, error: siblingError } = await supabase
    .from("job")
    .select("job_id, status, standard_price_snapshot")
    .eq("work_order_id", job.work_order_id)
    .in("status", ["in_progress", "completed"]);
  if (siblingError) throw siblingError;
  const alreadyAuthorizedSpendCents = (siblings ?? [])
    .filter((row) => row.job_id !== jobId)
    .reduce(
      (sum, row) => sum + dollarsToCents(row.standard_price_snapshot as number | null),
      0
    );

  const decision = chargeableStartDecision({
    priceCents,
    legacyApproved: LEGACY_APPROVED.has(String(job.status)),
    jobApprovedOnConfirmedVersion,
    estimateDocumentExists,
    maximumAuthorizationCents:
      workOrder?.maximum_authorization_cents == null
        ? null
        : Number(workOrder.maximum_authorization_cents),
    alreadyAuthorizedSpendCents,
    ceilingBps,
  });
  if (!decision.ok) throw new Error(decision.reason);
}
