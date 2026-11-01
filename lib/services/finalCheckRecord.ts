import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/database/supabase-server";
import { canCompleteInspection, canEditWorkOrder } from "@/lib/permissions";
import { addAuditLog } from "@/lib/audit/addAuditLog";
import {
  declinedSafetyReleaseBlock,
  validateFinalCheck,
  type RoadTestResult,
} from "@/lib/quality/finalCheck";

export type FinalCheckView = {
  technician_user_id: string;
  verifier_user_id: string;
  road_test_result: RoadTestResult;
  mileage_out: number | null;
  leaks: string | null;
  warning_lights: string | null;
  unresolved_defects: string | null;
  recorded_at: string;
};

export async function loadFinalCheck(workOrderId: string): Promise<FinalCheckView | null> {
  await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("final_check")
    .select(
      "technician_user_id, verifier_user_id, road_test_result, mileage_out, leaks, warning_lights, unresolved_defects, recorded_at"
    )
    .eq("work_order_id", workOrderId)
    .maybeSingle();
  if (error) throw error;
  return (data as FinalCheckView | null) ?? null;
}

export async function saveFinalCheck(
  workOrderId: string,
  input: {
    technicianUserId: string;
    verifierUserId: string;
    roadTestResult: RoadTestResult;
    mileageOut: number | null;
    leaks: string;
    warningLights: string;
    unresolvedDefects: string;
  }
): Promise<void> {
  const user = await requireUser();
  if (!canEditWorkOrder(user.role) && !canCompleteInspection(user.role)) {
    throw new Error("FORBIDDEN");
  }
  const parsed = validateFinalCheck({
    technicianUserId: input.technicianUserId,
    verifierUserId: input.verifierUserId,
    roadTestResult: input.roadTestResult,
    mileageOut: input.mileageOut,
  });
  if (!parsed.ok) throw new Error(parsed.errors[0] ?? "FINAL_CHECK_INVALID");

  const supabase = await createClient();
  const { data: workOrder, error: woError } = await supabase
    .from("work_order")
    .select("work_order_id, location_id, status")
    .eq("work_order_id", workOrderId)
    .maybeSingle();
  if (woError) throw woError;
  if (!workOrder) throw new Error("WORK_ORDER_NOT_FOUND");
  if (workOrder.location_id !== user.active_location_id) throw new Error("FOREIGN_LOCATION");

  const { data: clocks, error: clockError } = await supabase
    .from("job_time_entry")
    .select("user_id, job:job_id ( work_order_id )")
    .eq("user_id", input.verifierUserId);
  if (clockError) throw clockError;
  const verifierWorked = ((clocks ?? []) as Array<{ job?: { work_order_id?: string } | { work_order_id?: string }[] }>).some(
    (row) => {
      const job = Array.isArray(row.job) ? row.job[0] : row.job;
      return job?.work_order_id === workOrderId;
    }
  );
  if (verifierWorked) throw new Error("VERIFIER_WORKED_THE_JOB");

  const record = {
    work_order_id: workOrderId,
    technician_user_id: input.technicianUserId,
    verifier_user_id: input.verifierUserId,
    road_test_result: input.roadTestResult,
    mileage_out: input.mileageOut,
    leaks: input.leaks.trim() || null,
    warning_lights: input.warningLights.trim() || null,
    unresolved_defects: input.unresolvedDefects.trim() || null,
    recorded_at: new Date().toISOString(),
    recorded_by_user_id: user.user_id,
  };
  const { error } = await supabase.from("final_check").upsert(record, {
    onConflict: "work_order_id",
  });
  if (error) throw error;
  await addAuditLog(supabase, {
    actor_user_id: user.user_id,
    location_id: workOrder.location_id,
    action: "final_check_recorded",
    entity_type: "work_order",
    entity_id: workOrderId,
    description: "Final check recorded separately from the arrival inspection and safety check",
    new_value: {
      technician_user_id: input.technicianUserId,
      verifier_user_id: input.verifierUserId,
      road_test_result: input.roadTestResult,
    },
  });
}

export async function declinedSafetyItems(workOrderId: string): Promise<string[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("recommendation")
    .select("description, severity, status")
    .eq("work_order_id", workOrderId);
  if (error) throw error;
  return ((data ?? []) as Array<{ description: string; severity: string; status: string }>)
    .filter((row) => row.severity === "safety_critical" && row.status === "declined")
    .map((row) => row.description.trim())
    .filter(Boolean)
    .sort();
}

export async function assertDeclinedSafetyAcknowledged(workOrderId: string): Promise<void> {
  const items = await declinedSafetyItems(workOrderId);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("work_order")
    .select("declined_safety_ack_at, declined_safety_ack_items")
    .eq("work_order_id", workOrderId)
    .maybeSingle();
  if (error) throw error;
  const acknowledged =
    Boolean(data?.declined_safety_ack_at) &&
    String(data?.declined_safety_ack_items ?? "") === items.join("\n");
  if (declinedSafetyReleaseBlock({ declinedItems: items, acknowledged })) {
    throw new Error("DECLINED_SAFETY_ACK_REQUIRED");
  }
}

export async function acknowledgeDeclinedSafety(
  workOrderId: string,
  signerName: string
): Promise<void> {
  const user = await requireUser();
  if (!canEditWorkOrder(user.role)) throw new Error("FORBIDDEN");
  const name = signerName.trim();
  if (!name) throw new Error("ACK_SIGNER_REQUIRED");
  const items = await declinedSafetyItems(workOrderId);
  if (items.length === 0) throw new Error("NO_DECLINED_SAFETY");
  const supabase = await createClient();
  const { error } = await supabase
    .from("work_order")
    .update({
      declined_safety_ack_at: new Date().toISOString(),
      declined_safety_ack_signer: name,
      declined_safety_ack_items: items.join("\n"),
      updated_at: new Date().toISOString(),
    })
    .eq("work_order_id", workOrderId)
    .eq("location_id", user.active_location_id!);
  if (error) throw error;
  await addAuditLog(supabase, {
    actor_user_id: user.user_id,
    location_id: user.active_location_id,
    action: "declined_safety_acknowledged",
    entity_type: "work_order",
    entity_id: workOrderId,
    description:
      "Customer acknowledged the declined safety repairs. This record does not remove shop responsibility.",
    new_value: { signer: name, items },
  });
}
