"use server";

import { revalidatePath } from "next/cache";
import {
  assignAllActiveJobsOnWorkOrderToTechnician,
  openWorkOrderForControlCenter,
  unassignAllActiveJobsOnWorkOrder,
} from "@/lib/services/jobs";
import { clockStaffIn, clockStaffOut } from "@/lib/services/timeClock";
import { toFormErrorMessage } from "@/lib/services/errors";

function revalidateDispatch() {
  revalidatePath("/control-center");
  revalidatePath("/technician");
  revalidatePath("/technician/docket");
  revalidatePath("/dashboard");
}

export async function dispatchWorkOrderToTechnicianAction(
  workOrderId: string,
  technicianId: string
): Promise<{ error: string | null }> {
  try {
    await assignAllActiveJobsOnWorkOrderToTechnician(workOrderId, technicianId);
    revalidateDispatch();
    return { error: null };
  } catch (error) {
    return { error: toFormErrorMessage(error) };
  }
}

export async function unassignWorkOrderJobsAction(
  workOrderId: string
): Promise<{ error: string | null }> {
  try {
    await unassignAllActiveJobsOnWorkOrder(workOrderId);
    revalidateDispatch();
    return { error: null };
  } catch (error) {
    return { error: toFormErrorMessage(error) };
  }
}

export async function openWorkOrderAction(
  workOrderId: string
): Promise<{ error: string | null; opened_at?: string }> {
  try {
    const result = await openWorkOrderForControlCenter(workOrderId);
    revalidatePath("/control-center");
    return { error: null, opened_at: result.opened_at };
  } catch (error) {
    return { error: toFormErrorMessage(error) };
  }
}

export async function setStaffSignedInAction(
  staffUserId: string,
  signedIn: boolean
): Promise<{ error: string | null }> {
  try {
    if (signedIn) {
      await clockStaffIn(staffUserId);
    } else {
      await clockStaffOut(staffUserId);
    }
    revalidatePath("/control-center");
    revalidatePath("/technician");
    revalidatePath("/settings/timesheets");
    return { error: null };
  } catch (error) {
    return { error: toFormErrorMessage(error) };
  }
}
