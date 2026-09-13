import type { DbClient } from "@/lib/database/types";
import { computeQcScopeHash } from "@/lib/jobs-v2/scopeHash";

async function completedJobScope(
  supabase: DbClient,
  workOrderId: string
): Promise<string> {
  const { data: completedJobs, error } = await supabase
    .from("job")
    .select("job_id, completed_at")
    .eq("work_order_id", workOrderId)
    .eq("status", "completed");
  if (error) throw error;
  return computeQcScopeHash(
    (completedJobs ?? []).map((job) => ({
      jobId: job.job_id as string,
      completedAt: (job.completed_at as string | null) ?? null,
    }))
  );
}

/** Always record peer/office QC evidence with optional signature. */
export async function insertQualityCheckAttempt(
  supabase: DbClient,
  input: {
    workOrderId: string;
    locationId: string;
    actorUserId: string;
    assignedToUserId?: string | null;
    outcome: "passed" | "failed";
    notes?: string | null;
    signatureStoragePath?: string | null;
  }
): Promise<void> {
  const scopeHash = await completedJobScope(supabase, input.workOrderId);
  const { error } = await supabase.from("quality_check_attempt").insert({
    work_order_id: input.workOrderId,
    location_id: input.locationId,
    scope_hash: scopeHash,
    outcome: input.outcome,
    notes: input.notes ?? null,
    performed_by_user_id: input.actorUserId,
    assigned_to_user_id: input.assignedToUserId ?? null,
    signature_storage_path: input.signatureStoragePath ?? null,
  });
  if (error) throw error;
}

/** Always record head-tech final inspection evidence with optional signature. */
export async function insertSafetyCheckAttempt(
  supabase: DbClient,
  input: {
    workOrderId: string;
    locationId: string;
    actorUserId: string;
    outcome: "passed" | "failed";
    notes?: string | null;
    signatureStoragePath?: string | null;
  }
): Promise<void> {
  const scopeHash = await completedJobScope(supabase, input.workOrderId);
  const { error } = await supabase.from("safety_check_attempt").insert({
    work_order_id: input.workOrderId,
    location_id: input.locationId,
    scope_hash: scopeHash,
    outcome: input.outcome,
    notes: input.notes ?? null,
    performed_by_user_id: input.actorUserId,
    signature_storage_path: input.signatureStoragePath ?? null,
  });
  if (error) throw error;
}
