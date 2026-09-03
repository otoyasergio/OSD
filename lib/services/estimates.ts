import { randomUUID } from "node:crypto";
import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/database/supabase-server";
import { createAdminClient } from "@/lib/database/supabase-admin";
import { addAuditLog } from "@/lib/audit/addAuditLog";
import { canConvertRecommendation, canRecordCustomerApproval } from "@/lib/permissions";
import {
  buildEstimateVersionSnapshot,
  presentationBlockers,
  type EstimateJobDraft,
  type EstimateVersionSnapshot,
} from "@/lib/services/estimatePricing";
import {
  computeDecisionsHash,
  validateConfirmation,
  type DecisionInput,
} from "@/lib/services/estimateAuthorization";
import type {
  AuthorizationDecision,
  EstimateActorType,
  EstimateDecisionMethod,
  EstimateStatus,
} from "@/lib/database/types";

/**
 * Estimate document service. All writes run through the Workflow V2
 * SECURITY DEFINER commands (service-role RPC); reads use the caller's
 * RLS-scoped client so front-office visibility rules apply.
 */

export type EstimateVersionView = {
  estimate_id: string;
  estimate_version_id: string;
  version_no: number;
  status: EstimateStatus;
  subtotal_cents: number;
  discount_cents: number;
  tax_cents: number;
  total_cents: number;
  content_hash: string | null;
  presented_at: string | null;
  jobs: Array<{
    job_id: string;
    display_order: number;
    title_snapshot: string;
    pricing_mode_snapshot: string;
    labor_cents: number;
    parts_cents: number;
    fees_cents: number;
    discount_cents: number;
    tax_cents: number;
    total_cents: number;
    decision: AuthorizationDecision | null;
  }>;
  confirmed: boolean;
};

export async function getLiveEstimateForWorkOrder(
  workOrderId: string
): Promise<EstimateVersionView | null> {
  await requireUser();
  const supabase = await createClient();

  const { data: estimate, error } = await supabase
    .from("estimate")
    .select("estimate_id, status, current_version_id")
    .eq("work_order_id", workOrderId)
    .in("status", ["draft", "presented", "confirmed"])
    .maybeSingle();
  if (error) throw error;
  if (!estimate?.current_version_id) return null;

  const { data: version, error: versionError } = await supabase
    .from("estimate_version")
    .select(
      "estimate_version_id, estimate_id, version_no, status, subtotal_cents, discount_cents, tax_cents, total_cents, content_hash, presented_at"
    )
    .eq("estimate_version_id", estimate.current_version_id)
    .maybeSingle();
  if (versionError) throw versionError;
  if (!version) return null;

  const [{ data: jobs, error: jobsError }, { data: decisions, error: decError }] =
    await Promise.all([
      supabase
        .from("estimate_job")
        .select(
          "job_id, display_order, title_snapshot, pricing_mode_snapshot, labor_cents, parts_cents, fees_cents, discount_cents, tax_cents, total_cents"
        )
        .eq("estimate_version_id", version.estimate_version_id)
        .order("display_order"),
      supabase
        .from("estimate_job_decision")
        .select("job_id, decision")
        .eq("estimate_version_id", version.estimate_version_id),
    ]);
  if (jobsError) throw jobsError;
  if (decError) throw decError;

  const decisionByJob = new Map(
    (decisions ?? []).map((d) => [
      d.job_id as string,
      d.decision as AuthorizationDecision,
    ])
  );

  const { data: confirmation } = await supabase
    .from("estimate_confirmation")
    .select("confirmation_id")
    .eq("estimate_version_id", version.estimate_version_id)
    .maybeSingle();

  return {
    estimate_id: version.estimate_id,
    estimate_version_id: version.estimate_version_id,
    version_no: version.version_no,
    status: version.status as EstimateStatus,
    subtotal_cents: version.subtotal_cents,
    discount_cents: version.discount_cents,
    tax_cents: version.tax_cents,
    total_cents: version.total_cents,
    content_hash: version.content_hash,
    presented_at: version.presented_at,
    jobs: (jobs ?? []).map((job) => ({
      ...job,
      decision: decisionByJob.get(job.job_id as string) ?? null,
    })) as EstimateVersionView["jobs"],
    confirmed: Boolean(confirmation),
  };
}

export async function listEstimateVersionHistory(workOrderId: string) {
  await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("estimate_version")
    .select(
      `
      estimate_version_id, version_no, status, subtotal_cents, tax_cents,
      total_cents, presented_at, finalized_at, created_at,
      estimate:estimate_id!inner ( work_order_id )
      `
    )
    .eq("estimate.work_order_id", workOrderId)
    .order("version_no", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

/**
 * Present a frozen estimate version built from the given job drafts.
 * Blocks on missing prices; supersedes any previously presented version.
 */
export async function presentEstimate(
  workOrderId: string,
  drafts: EstimateJobDraft[]
): Promise<{ estimateVersionId: string; snapshot: EstimateVersionSnapshot }> {
  const user = await requireUser();
  if (!canConvertRecommendation(user.role)) throw new Error("FORBIDDEN");

  const snapshot = buildEstimateVersionSnapshot(drafts);
  const blockers = presentationBlockers(snapshot);
  if (blockers.length > 0) throw new Error(blockers[0]);

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("workflow_v2_present_estimate", {
    p_work_order_id: workOrderId,
    p_actor_user_id: user.user_id,
    p_payload: {
      jobs: snapshot.jobs.map((job) => ({
        jobId: job.jobId,
        displayOrder: job.displayOrder,
        title: job.title,
        description: job.description,
        pricingMode: job.pricingMode,
        laborCents: job.breakdown.laborCents,
        partsCents: job.breakdown.partsCents,
        feesCents: job.breakdown.feesCents,
        discountCents: job.breakdown.discountCents,
        taxCents: job.breakdown.taxCents,
        totalCents: job.breakdown.totalCents,
      })),
      lines: snapshot.lines.map((line) => ({
        kind: line.kind,
        jobId: line.job_id,
        description: line.description,
        quantity: line.quantity,
        unitAmountCents: line.unit_amount_cents,
        extendedAmountCents: line.extended_amount_cents,
        taxRateBps: line.tax_rate_bps,
        taxAmountCents: line.tax_amount_cents,
        position: line.position,
      })),
      totals: {
        subtotalCents: snapshot.totals.subtotalCents,
        discountCents: snapshot.totals.discountCents,
        taxCents: snapshot.totals.taxCents,
        totalCents: snapshot.totals.totalCents,
      },
      contentHash: snapshot.contentHash,
    },
    p_idempotency_key: `present:${workOrderId}:${snapshot.contentHash}`,
  });
  if (error) throw error;

  const supabase = await createClient();
  await addAuditLog(supabase, {
    actor_user_id: user.user_id,
    location_id: user.active_location_id,
    action: "estimate_presented",
    entity_type: "estimate",
    entity_id: (data as { estimate_id?: string })?.estimate_id ?? workOrderId,
    description: `Estimate presented (${snapshot.jobs.length} jobs, $${(
      snapshot.totals.totalCents / 100
    ).toFixed(2)})`,
    new_value: {
      content_hash: snapshot.contentHash,
      total_cents: snapshot.totals.totalCents,
    },
  });

  return {
    estimateVersionId: (data as { estimate_version_id: string }).estimate_version_id,
    snapshot,
  };
}

export type ConfirmEstimateInput = {
  estimateVersionId: string;
  decisions: DecisionInput[];
  expectedContentHash: string;
  actorType: EstimateActorType;
  method: EstimateDecisionMethod;
  portalTokenId?: string | null;
  signerName?: string | null;
  signerContact?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
};

/**
 * Record every per-job decision plus the single aggregate confirmation.
 * Staff callers must hold approval-recording permission; portal callers are
 * authenticated by token upstream (lib/services/portal.ts).
 */
export async function confirmEstimate(
  input: ConfirmEstimateInput
): Promise<{ confirmationId: string; replayed: boolean }> {
  let actorUserId: string | null = null;
  if (input.actorType === "staff") {
    const user = await requireUser();
    if (!canRecordCustomerApproval(user.role)) throw new Error("FORBIDDEN");
    actorUserId = user.user_id;
  }

  const admin = createAdminClient();

  // Pre-validate against the presented snapshot for a clean error before the
  // transactional command re-checks everything under lock.
  const { data: version, error: versionError } = await admin
    .from("estimate_version")
    .select("estimate_version_id, status, content_hash")
    .eq("estimate_version_id", input.estimateVersionId)
    .maybeSingle();
  if (versionError) throw versionError;
  if (!version) throw new Error("ESTIMATE_VERSION_NOT_FOUND");

  const { data: presentedJobs, error: jobsError } = await admin
    .from("estimate_job")
    .select("job_id")
    .eq("estimate_version_id", input.estimateVersionId);
  if (jobsError) throw jobsError;

  const validation = validateConfirmation({
    presentedJobIds: (presentedJobs ?? []).map((row) => row.job_id as string),
    decisions: input.decisions,
    expectedContentHash: input.expectedContentHash,
    actualContentHash: version.content_hash ?? "",
    versionStatus: version.status as EstimateStatus,
  });
  if (!validation.ok) {
    // The command handles confirmed-replay idempotency itself.
    if (!validation.errors.includes("ESTIMATE_ALREADY_CONFIRMED")) {
      throw new Error(validation.errors[0]);
    }
  }

  const decisionsHash = computeDecisionsHash(input.decisions);
  const { data, error } = await admin.rpc("workflow_v2_confirm_estimate", {
    p_estimate_version_id: input.estimateVersionId,
    p_decisions: input.decisions.map((d) => ({
      jobId: d.jobId,
      decision: d.decision,
    })),
    p_decisions_hash: decisionsHash,
    p_expected_content_hash: input.expectedContentHash,
    p_actor_type: input.actorType,
    p_actor_user_id: actorUserId,
    p_portal_token_id: input.portalTokenId ?? null,
    p_method: input.method,
    p_signer_name: input.signerName ?? null,
    p_signer_contact: input.signerContact ?? null,
    p_ip_address: input.ipAddress ?? null,
    p_user_agent: input.userAgent ?? null,
    p_idempotency_key: `confirm:${input.estimateVersionId}:${decisionsHash}`,
  });
  if (error) throw error;

  const result = data as { confirmation_id: string; replayed: boolean };

  // Refresh the legacy work-order projection after the transaction.
  const { recalculateWorkOrderStatus } =
    await import("@/lib/status/recalculateWorkOrderStatus");
  const { data: est } = await admin
    .from("estimate_version")
    .select("estimate:estimate_id!inner ( work_order_id )")
    .eq("estimate_version_id", input.estimateVersionId)
    .maybeSingle();
  const workOrderId = (est as unknown as { estimate: { work_order_id: string } } | null)
    ?.estimate?.work_order_id;
  if (workOrderId) {
    await recalculateWorkOrderStatus(admin, workOrderId, actorUserId);
  }

  return { confirmationId: result.confirmation_id, replayed: result.replayed };
}

/** Issue an immutable invoice copied from the confirmed approved scope. */
export async function issueInvoiceFromConfirmedScope(
  workOrderId: string
): Promise<{ invoiceId: string; invoiceNumber: string; totalCents: number }> {
  const user = await requireUser();
  if (!canConvertRecommendation(user.role)) throw new Error("FORBIDDEN");

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("workflow_v2_issue_invoice", {
    p_work_order_id: workOrderId,
    p_actor_user_id: user.user_id,
    p_idempotency_key: `invoice:${workOrderId}:${randomUUID()}`,
  });
  if (error) throw error;
  const result = data as {
    invoice_id: string;
    invoice_number: string;
    total_cents: number;
  };
  return {
    invoiceId: result.invoice_id,
    invoiceNumber: result.invoice_number,
    totalCents: result.total_cents,
  };
}
