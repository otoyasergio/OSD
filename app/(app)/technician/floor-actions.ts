"use server";

import { revalidatePath } from "next/cache";
import { toFormErrorMessage } from "@/lib/services/errors";
import { pullJob, updateJobStatus } from "@/lib/services/jobs";
import { toggleJobChecklistItem } from "@/lib/services/jobChecklist";
import { createAdminFlag } from "@/lib/services/adminFlags";
import { failPeerQualityCheck, passPeerQualityCheck } from "@/lib/services/peerQc";
import { uploadIntakePhoto } from "@/lib/services/photos";
import { addTechnicianNote } from "@/lib/services/notes";
import { updatePartStatus } from "@/lib/services/parts";
import type { AdminFlagReason } from "@/lib/database/types";

export type FloorActionState = {
  error?: string;
  success?: string;
} | null;

function revalidateFloor(workOrderId?: string) {
  revalidatePath("/technician");
  revalidatePath("/dashboard");
  if (workOrderId) {
    revalidatePath(`/work_orders/${workOrderId}`);
  }
}

export async function pullJobAction(
  _prev: FloorActionState,
  formData: FormData
): Promise<FloorActionState> {
  try {
    const jobId = String(formData.get("job_id") ?? "");
    const workOrderId = String(formData.get("work_order_id") ?? "");
    await pullJob(jobId);
    revalidateFloor(workOrderId);
    return { success: "Job pulled into your queue." };
  } catch (error) {
    return { error: toFormErrorMessage(error) };
  }
}

export async function startJobFloorAction(
  _prev: FloorActionState,
  formData: FormData
): Promise<FloorActionState> {
  try {
    const jobId = String(formData.get("job_id") ?? "");
    const workOrderId = String(formData.get("work_order_id") ?? "");
    await updateJobStatus(jobId, "in_progress");
    revalidateFloor(workOrderId);
    return { success: "Job started." };
  } catch (error) {
    return { error: toFormErrorMessage(error) };
  }
}

export async function completeJobFloorAction(
  _prev: FloorActionState,
  formData: FormData
): Promise<FloorActionState> {
  try {
    const jobId = String(formData.get("job_id") ?? "");
    const workOrderId = String(formData.get("work_order_id") ?? "");
    await updateJobStatus(jobId, "completed");
    revalidateFloor(workOrderId);
    return { success: "Job completed." };
  } catch (error) {
    return { error: toFormErrorMessage(error) };
  }
}

export async function toggleChecklistAction(
  _prev: FloorActionState,
  formData: FormData
): Promise<FloorActionState> {
  try {
    const itemId = String(formData.get("item_id") ?? "");
    const checked = String(formData.get("checked") ?? "") === "true";
    const workOrderId = String(formData.get("work_order_id") ?? "");
    await toggleJobChecklistItem(itemId, checked);
    revalidateFloor(workOrderId);
    return { success: "Checklist updated." };
  } catch (error) {
    return { error: toFormErrorMessage(error) };
  }
}

export async function flagForAdminAction(
  _prev: FloorActionState,
  formData: FormData
): Promise<FloorActionState> {
  try {
    const workOrderId = String(formData.get("work_order_id") ?? "");
    const jobId = String(formData.get("job_id") ?? "") || null;
    const reason = String(formData.get("reason") ?? "") as AdminFlagReason;
    const note = String(formData.get("note") ?? "") || null;
    await createAdminFlag({
      workOrderId,
      jobId,
      reason,
      note,
      stopActiveJob: true,
    });
    revalidateFloor(workOrderId);
    return { success: "Flagged for admin." };
  } catch (error) {
    return { error: toFormErrorMessage(error) };
  }
}

export async function uploadJobProofAction(
  _prev: FloorActionState,
  formData: FormData
): Promise<FloorActionState> {
  try {
    const workOrderId = String(formData.get("work_order_id") ?? "");
    const jobId = String(formData.get("job_id") ?? "");
    const file = formData.get("file");
    if (!(file instanceof File)) throw new Error("PHOTO_REQUIRED");
    await uploadIntakePhoto(workOrderId, {
      category: "job_proof",
      job_id: jobId,
      file,
    });
    revalidateFloor(workOrderId);
    return { success: "Proof photo uploaded." };
  } catch (error) {
    return { error: toFormErrorMessage(error) };
  }
}

export async function addProofExceptionAction(
  _prev: FloorActionState,
  formData: FormData
): Promise<FloorActionState> {
  try {
    const workOrderId = String(formData.get("work_order_id") ?? "");
    const jobId = String(formData.get("job_id") ?? "");
    const note = String(formData.get("note") ?? "");
    await addTechnicianNote(workOrderId, {
      note,
      note_type: "proof_exception",
      job_id: jobId,
    });
    revalidateFloor(workOrderId);
    return { success: "Proof exception saved." };
  } catch (error) {
    return { error: toFormErrorMessage(error) };
  }
}

export async function installPartFloorAction(
  _prev: FloorActionState,
  formData: FormData
): Promise<FloorActionState> {
  try {
    const partId = String(formData.get("part_id") ?? "");
    const workOrderId = String(formData.get("work_order_id") ?? "");
    await updatePartStatus(partId, "installed");
    revalidateFloor(workOrderId);
    return { success: "Part marked installed." };
  } catch (error) {
    return { error: toFormErrorMessage(error) };
  }
}

export async function passPeerQcAction(
  _prev: FloorActionState,
  formData: FormData
): Promise<FloorActionState> {
  try {
    const workOrderId = String(formData.get("work_order_id") ?? "");
    const notes = String(formData.get("notes") ?? "") || null;
    await passPeerQualityCheck(workOrderId, notes);
    revalidateFloor(workOrderId);
    return { success: "Quality check passed." };
  } catch (error) {
    return { error: toFormErrorMessage(error) };
  }
}

export async function failPeerQcAction(
  _prev: FloorActionState,
  formData: FormData
): Promise<FloorActionState> {
  try {
    const workOrderId = String(formData.get("work_order_id") ?? "");
    const reason = String(formData.get("reason") ?? "");
    await failPeerQualityCheck(workOrderId, reason);
    revalidateFloor(workOrderId);
    return { success: "Quality check failed — returned for rework." };
  } catch (error) {
    return { error: toFormErrorMessage(error) };
  }
}
