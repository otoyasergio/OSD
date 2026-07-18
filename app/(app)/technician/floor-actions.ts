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
import type { AdminFlagReason, FloorParkReason } from "@/lib/database/types";
import { chooseNextFloorItem } from "@/lib/technician/nextFloorItem";
import {
  acknowledgeDocketJob,
  clearParkOnComplete,
  parkJob,
  pullOntoBench,
  resumeParkedJob,
  swapBenchJob,
} from "@/lib/services/jobFloorState";

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

export async function acknowledgeDocketJobAction(
  _prev: FloorActionState,
  formData: FormData
): Promise<FloorActionState> {
  try {
    const jobId = String(formData.get("job_id") ?? "");
    const workOrderId = String(formData.get("work_order_id") ?? "");
    await acknowledgeDocketJob(jobId);
    revalidateFloor(workOrderId);
    return { success: "Got it — it's in your line." };
  } catch (error) {
    return { error: toFormErrorMessage(error) };
  }
}

export async function pullOntoBenchAction(
  _prev: FloorActionState,
  formData: FormData
): Promise<FloorActionState> {
  try {
    const jobId = String(formData.get("job_id") ?? "");
    const workOrderId = String(formData.get("work_order_id") ?? "");
    await pullOntoBench(jobId);
    revalidateFloor(workOrderId);
    return { success: "On the bench — clock started." };
  } catch (error) {
    return { error: toFormErrorMessage(error) };
  }
}

export async function parkJobAction(
  _prev: FloorActionState,
  formData: FormData
): Promise<FloorActionState> {
  try {
    const jobId = String(formData.get("job_id") ?? "");
    const workOrderId = String(formData.get("work_order_id") ?? "");
    const reason = String(formData.get("reason") ?? "") as FloorParkReason;
    await parkJob(jobId, reason);
    revalidateFloor(workOrderId);
    return { success: "Parked — your spot is saved and the clock is paused." };
  } catch (error) {
    return { error: toFormErrorMessage(error) };
  }
}

export async function resumeParkedJobAction(
  _prev: FloorActionState,
  formData: FormData
): Promise<FloorActionState> {
  try {
    const jobId = String(formData.get("job_id") ?? "");
    const workOrderId = String(formData.get("work_order_id") ?? "");
    await resumeParkedJob(jobId);
    revalidateFloor(workOrderId);
    return { success: "Resumed — back on the bench." };
  } catch (error) {
    return { error: toFormErrorMessage(error) };
  }
}

export async function swapBenchJobAction(
  _prev: FloorActionState,
  formData: FormData
): Promise<FloorActionState> {
  try {
    const fromJobId = String(formData.get("from_job_id") ?? "");
    const toJobId = String(formData.get("to_job_id") ?? "");
    const workOrderId = String(formData.get("work_order_id") ?? "");
    await swapBenchJob(fromJobId, toJobId);
    revalidateFloor(workOrderId);
    const { redirect } = await import("next/navigation");
    redirect(`/technician?job=${toJobId}&wo=${workOrderId}`);
    return { success: "Swapped." };
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "digest" in error &&
      String((error as { digest?: string }).digest).startsWith("NEXT_REDIRECT")
    ) {
      throw error;
    }
    return { error: toFormErrorMessage(error) };
  }
}

export async function skipProofAction(
  _prev: FloorActionState,
  formData: FormData
): Promise<FloorActionState> {
  try {
    const workOrderId = String(formData.get("work_order_id") ?? "");
    const jobId = String(formData.get("job_id") ?? "");
    const reason = String(formData.get("reason") ?? "").trim();
    if (!reason) throw new Error("PROOF_SKIP_REASON_REQUIRED");
    await addTechnicianNote(workOrderId, {
      note: `Proof skipped: ${reason}`,
      note_type: "proof_exception",
      job_id: jobId,
    });
    revalidateFloor(workOrderId);
    return { success: "Proof skipped — step marked done." };
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
    const qcAssigneeId = String(formData.get("qc_assignee_id") ?? "").trim();
    await updateJobStatus(jobId, "completed");
    await clearParkOnComplete(jobId);
    if (qcAssigneeId) {
      const { assignPeerQcByTechnician } = await import("@/lib/services/peerQc");
      await assignPeerQcByTechnician(workOrderId, qcAssigneeId);
    }
    revalidateFloor(workOrderId);

    const { getTechnicianFloorOs } = await import("@/lib/services/technicianFloor");
    const floor = await getTechnicianFloorOs({});
    const next = chooseNextFloorItem(floor, workOrderId);
    if (next) {
      const params = new URLSearchParams();
      if (next.job_id) params.set("job", next.job_id);
      params.set("wo", next.work_order_id);
      if (next.kind === "qc") params.set("stage", "qc");
      const { redirect } = await import("next/navigation");
      redirect(`/technician?${params.toString()}`);
    }

    return { success: "Job completed." };
  } catch (error) {
    // redirect() throws a special NEXT_REDIRECT error — rethrow it.
    if (
      error &&
      typeof error === "object" &&
      "digest" in error &&
      String((error as { digest?: string }).digest).startsWith("NEXT_REDIRECT")
    ) {
      throw error;
    }
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

/** Save a technician note from the Perform work sheet without marking work done. */
export async function savePerformWorkNoteAction(
  _prev: FloorActionState,
  formData: FormData
): Promise<FloorActionState> {
  try {
    const workOrderId = String(formData.get("work_order_id") ?? "");
    const jobId = String(formData.get("job_id") ?? "");
    const note = String(formData.get("note") ?? "").trim();
    if (!note) throw new Error("NOTE_REQUIRED");
    await addTechnicianNote(workOrderId, {
      note,
      note_type: "general",
      job_id: jobId,
    });
    revalidateFloor(workOrderId);
    return { success: "Note saved." };
  } catch (error) {
    return { error: toFormErrorMessage(error) };
  }
}

/** Mark Perform work done; optional after photo attached in the same tap. */
export async function completePerformWorkAction(
  _prev: FloorActionState,
  formData: FormData
): Promise<FloorActionState> {
  try {
    const workOrderId = String(formData.get("work_order_id") ?? "");
    const jobId = String(formData.get("job_id") ?? "");
    const itemId = String(formData.get("item_id") ?? "");
    const file = formData.get("file");
    if (file instanceof File && file.size > 0 && file.name && file.name !== "undefined") {
      await uploadIntakePhoto(workOrderId, {
        category: "job_proof",
        job_id: jobId,
        file,
      });
    }
    await toggleJobChecklistItem(itemId, true);
    revalidateFloor(workOrderId);
    return { success: "Work marked done." };
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

export async function pauseJobFloorAction(
  _prev: FloorActionState,
  formData: FormData
): Promise<FloorActionState> {
  try {
    const workOrderId = String(formData.get("work_order_id") ?? "");
    const { pauseJobTime } = await import("@/lib/services/jobTimeClock");
    await pauseJobTime();
    revalidateFloor(workOrderId);
    return { success: "Job timer paused." };
  } catch (error) {
    return { error: toFormErrorMessage(error) };
  }
}

export async function resumeJobFloorAction(
  _prev: FloorActionState,
  formData: FormData
): Promise<FloorActionState> {
  try {
    const jobId = String(formData.get("job_id") ?? "");
    const workOrderId = String(formData.get("work_order_id") ?? "");
    const { startJobTime } = await import("@/lib/services/jobTimeClock");
    await startJobTime(jobId);
    revalidateFloor(workOrderId);
    return { success: "Job timer resumed." };
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
