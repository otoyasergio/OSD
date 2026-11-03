"use server";

import { revalidatePath } from "next/cache";
import { getRolePreviewContext } from "@/lib/auth/role-preview";
import { parseDiagnosticSessionForm } from "@/lib/diagnostics/sessionForm";
import {
  recordDiagnosticSession,
  removeDiagnosticSession,
} from "@/lib/services/diagnosticSessions";
import { toFormErrorMessage } from "@/lib/services/errors";

export type DiagnosticActionState = { error: string | null };

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function refreshDiagnosticViews(
  motorcycleId: string,
  workOrderId: string | null,
  customerId: string
) {
  revalidatePath(`/motorcycles/${motorcycleId}`);
  revalidatePath("/motorcycles");
  if (workOrderId) revalidatePath(`/work_orders/${workOrderId}`);
  if (customerId) revalidatePath(`/customers/${customerId}`);
  revalidatePath("/customers");
  revalidatePath("/technician");
}

export async function recordDiagnosticSessionAction(
  _prev: DiagnosticActionState,
  formData: FormData
): Promise<DiagnosticActionState> {
  const preview = await getRolePreviewContext();
  if (preview?.isPreviewing) {
    return { error: "You cannot record a scan while previewing another role." };
  }
  const parsed = parseDiagnosticSessionForm(formData);
  if (!parsed.ok) return { error: parsed.error };

  try {
    await recordDiagnosticSession(parsed.value);
  } catch (error) {
    return { error: toFormErrorMessage(error) };
  }

  const customerId = String(formData.get("customer_id") ?? "").trim();
  refreshDiagnosticViews(
    parsed.value.motorcycleId,
    parsed.value.workOrderId,
    UUID_PATTERN.test(customerId) ? customerId : ""
  );
  return { error: null };
}

export async function removeDiagnosticSessionAction(
  _prev: DiagnosticActionState,
  formData: FormData
): Promise<DiagnosticActionState> {
  const preview = await getRolePreviewContext();
  if (preview?.isPreviewing) {
    return { error: "You cannot remove a scan while previewing another role." };
  }
  const sessionId = String(formData.get("session_id") ?? "").trim();
  const motorcycleId = String(formData.get("motorcycle_id") ?? "").trim();
  if (!UUID_PATTERN.test(sessionId) || !UUID_PATTERN.test(motorcycleId)) {
    return { error: "That scan could not be removed." };
  }
  const workOrderRaw = String(formData.get("work_order_id") ?? "").trim();
  const customerRaw = String(formData.get("customer_id") ?? "").trim();

  try {
    await removeDiagnosticSession(sessionId);
  } catch (error) {
    return { error: toFormErrorMessage(error) };
  }

  refreshDiagnosticViews(
    motorcycleId,
    UUID_PATTERN.test(workOrderRaw) ? workOrderRaw : null,
    UUID_PATTERN.test(customerRaw) ? customerRaw : ""
  );
  return { error: null };
}
