"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { requireUser, type AppUser } from "@/lib/auth/session";
import {
  completeInspection,
  saveInspectionResult,
  type CompletedInspection,
} from "@/lib/services/inspections";
import {
  createOrReuseDiagnosticsTriggerThreadInternal,
  diagnosticsSafeFailureCode,
  generateDiagnosticsTriggerResponseInternal,
} from "@/lib/services/diagnosticsAssistant";
import { toFormErrorMessage } from "@/lib/services/errors";
import { recordUxFailure } from "@/lib/services/uxEvents";
import type { InspectionResultStatus } from "@/lib/database/types";
import { isFloorTech } from "@/lib/permissions";
import {
  floorAssistantPacketHref,
  floorAssistantReturnHref,
  floorReturnJobIdForWorkOrder,
  safeFloorReturnTo,
} from "@/lib/technician/assignmentHref";

export type InspectionFormState = { error: string | null };

function revalidateInspection(workOrderId: string) {
  revalidatePath(`/work_orders/${workOrderId}`);
  revalidatePath(`/work_orders/${workOrderId}/inspection`);
  revalidatePath("/work_orders");
  revalidatePath("/technician");
}

export async function saveInspectionResultAction(
  workOrderId: string,
  inspectionResultId: string,
  input: {
    status?: InspectionResultStatus | null;
    measurement?: string | null;
    notes?: string | null;
  }
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await saveInspectionResult(inspectionResultId, input);
  } catch (error) {
    return { ok: false, error: toFormErrorMessage(error) };
  }

  revalidateInspection(workOrderId);
  return { ok: true };
}

export async function completeInspectionAction(
  workOrderId: string,
  _prevState: InspectionFormState,
  formData: FormData
): Promise<InspectionFormState> {
  let actor: AppUser;
  let completion: CompletedInspection;
  try {
    actor = await requireUser();
    completion = await completeInspection(workOrderId, {
      force: formData.get("force") === "true",
      signatureDataUrl: String(formData.get("signature_data_url") ?? ""),
    });
  } catch (error) {
    const message = await recordUxFailure(error, {
      source: "inspection.complete",
      context: { work_order_id: workOrderId },
    });
    return { error: message };
  }

  const rawReturnTo = String(formData.get("return_to") ?? "");
  const floorReturn = safeFloorReturnTo(rawReturnTo);
  const jobId = floorReturnJobIdForWorkOrder(workOrderId, floorReturn);
  let threadId: string | null = null;
  let threadLocationId: string | null = null;
  try {
    const thread = await createOrReuseDiagnosticsTriggerThreadInternal(actor, {
      workOrderId,
      jobId,
      mode: "shop",
      trigger: "inspection_completion",
      triggerEntityId: completion.inspectionId,
    });
    threadId = thread.threadId;
    threadLocationId = thread.locationId;
  } catch (error) {
    console.error("Inspection assistant handoff unavailable", {
      work_order_id: workOrderId,
      inspection_id: completion.inspectionId,
      safe_error_code: diagnosticsSafeFailureCode(error),
    });
  }

  if (threadId) {
    const trigger = {
      workOrderId,
      threadId,
      trigger: "inspection_completion" as const,
      triggerEntityId: completion.inspectionId,
    };
    const actorSnapshot = {
      userId: actor.user_id,
      locationId: threadLocationId!,
    };
    after(async () => {
      try {
        await generateDiagnosticsTriggerResponseInternal(actorSnapshot, trigger);
      } catch (error) {
        console.error("Inspection assistant generation failed", {
          work_order_id: trigger.workOrderId,
          inspection_id: trigger.triggerEntityId,
          thread_id: trigger.threadId,
          safe_error_code: diagnosticsSafeFailureCode(error),
        });
      }
    });
  }

  revalidateInspection(workOrderId);
  if (floorReturn) {
    const assistantFloorReturn =
      threadId && floorAssistantReturnHref(workOrderId, threadId, floorReturn);
    redirect(assistantFloorReturn ?? floorReturn);
  }
  if (threadId && isFloorTech(actor.role)) {
    const floorHref = floorAssistantPacketHref(workOrderId, threadId);
    if (floorHref) redirect(floorHref);
  }
  if (threadId) {
    const params = new URLSearchParams({ tab: "assistant", thread: threadId });
    redirect(`/work_orders/${encodeURIComponent(workOrderId)}?${params.toString()}`);
  }
  return { error: null };
}
