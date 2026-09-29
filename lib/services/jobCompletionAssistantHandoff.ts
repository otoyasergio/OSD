import "server-only";

import { after } from "next/server";
import { requireUser } from "@/lib/auth/session";
import { getRolePreviewContext } from "@/lib/auth/role-preview";
import {
  createOrReuseDiagnosticsTriggerThreadInternal,
  diagnosticsSafeFailureCode,
  generateDiagnosticsTriggerResponseInternal,
} from "@/lib/services/diagnosticsAssistant";

export type JobCompletionAssistantHandoff = {
  afterSuccessfulCompletion(input: { workOrderId: string; jobId: string }): Promise<void>;
};

/**
 * Capture the authenticated actor before the caller performs its existing job
 * completion. The returned best-effort handoff is called only after that
 * completion succeeds and never mutates workflow state itself.
 */
export async function prepareJobCompletionAssistantHandoff(): Promise<JobCompletionAssistantHandoff> {
  const actor = await requireUser();
  try {
    const preview = await getRolePreviewContext();
    if (!preview || preview.isPreviewing) {
      return { async afterSuccessfulCompletion() {} };
    }
  } catch {
    return { async afterSuccessfulCompletion() {} };
  }

  return {
    async afterSuccessfulCompletion(input) {
      try {
        const thread = await createOrReuseDiagnosticsTriggerThreadInternal(actor, {
          workOrderId: input.workOrderId,
          jobId: input.jobId,
          mode: "shop",
          trigger: "job_completion",
          triggerEntityId: input.jobId,
        });
        const creatorUserId = thread.createdByUserId ?? actor.user_id;
        after(async () => {
          try {
            await generateDiagnosticsTriggerResponseInternal(
              {
                userId: creatorUserId,
                locationId: thread.locationId,
              },
              {
                workOrderId: input.workOrderId,
                threadId: thread.threadId,
                jobId: input.jobId,
                trigger: "job_completion",
                triggerEntityId: input.jobId,
              }
            );
          } catch (error) {
            console.error("Job completion assistant generation failed", {
              work_order_id: input.workOrderId,
              job_id: input.jobId,
              thread_id: thread.threadId,
              safe_error_code: diagnosticsSafeFailureCode(error),
            });
          }
        });
      } catch (error) {
        console.error("Job completion assistant handoff unavailable", {
          work_order_id: input.workOrderId,
          job_id: input.jobId,
          safe_error_code: diagnosticsSafeFailureCode(error),
        });
      }
    },
  };
}
