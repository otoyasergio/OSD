"use server";

import { revalidatePath } from "next/cache";
import {
  addJobToWorkOrder,
  assignTechnicianToJob,
  recordCustomerApproval,
  recordCustomerDecline,
  updateJobStatus,
} from "@/lib/services/jobs";
import { toFormErrorMessage } from "@/lib/services/errors";
import type { JobStatus } from "@/lib/database/types";

export type JobFormState = { error: string | null };

function revalidateWorkOrder(workOrderId: string) {
  revalidatePath(`/work_orders/${workOrderId}`);
  revalidatePath("/work_orders");
  revalidatePath("/dashboard");
  revalidatePath("/technician");
  revalidatePath("/technician/docket");
}

export async function addJobAction(
  workOrderId: string,
  _prevState: JobFormState,
  formData: FormData
): Promise<JobFormState> {
  try {
    await addJobToWorkOrder(workOrderId, {
      service_id: String(formData.get("service_id") ?? ""),
      require_approval: formData.get("require_approval") === "true",
    });
  } catch (error) {
    return { error: toFormErrorMessage(error) };
  }

  revalidateWorkOrder(workOrderId);
  return { error: null };
}

export async function assignJobTechnicianAction(
  workOrderId: string,
  jobId: string,
  _prevState: JobFormState,
  formData: FormData
): Promise<JobFormState> {
  try {
    await assignTechnicianToJob(jobId, String(formData.get("technician_id") ?? ""));
  } catch (error) {
    return { error: toFormErrorMessage(error) };
  }

  revalidateWorkOrder(workOrderId);
  return { error: null };
}

export async function updateJobStatusAction(
  workOrderId: string,
  jobId: string,
  _prevState: JobFormState,
  formData: FormData
): Promise<JobFormState> {
  try {
    await updateJobStatus(jobId, String(formData.get("status") ?? "") as JobStatus, {
      note: String(formData.get("note") ?? ""),
    });
  } catch (error) {
    return { error: toFormErrorMessage(error) };
  }

  revalidateWorkOrder(workOrderId);
  return { error: null };
}

export async function approveJobAction(
  workOrderId: string,
  jobId: string,
  _prevState: JobFormState,
  formData: FormData
): Promise<JobFormState> {
  try {
    await recordCustomerApproval(jobId, String(formData.get("approval_method") ?? ""));
  } catch (error) {
    return { error: toFormErrorMessage(error) };
  }

  revalidateWorkOrder(workOrderId);
  return { error: null };
}

export async function declineJobAction(
  workOrderId: string,
  jobId: string,
  _prevState: JobFormState,
  formData: FormData
): Promise<JobFormState> {
  try {
    await recordCustomerDecline(jobId, String(formData.get("decline_reason") ?? ""));
  } catch (error) {
    return { error: toFormErrorMessage(error) };
  }

  revalidateWorkOrder(workOrderId);
  return { error: null };
}

export async function cancelJobAction(
  workOrderId: string,
  jobId: string,
  _prevState: JobFormState,
  formData: FormData
): Promise<JobFormState> {
  try {
    await updateJobStatus(jobId, "cancelled", {
      note: String(formData.get("note") ?? ""),
    });
  } catch (error) {
    return { error: toFormErrorMessage(error) };
  }

  revalidateWorkOrder(workOrderId);
  return { error: null };
}
