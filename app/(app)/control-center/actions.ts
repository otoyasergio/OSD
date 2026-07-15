"use server";

import { revalidatePath } from "next/cache";
import {
  assignAllActiveJobsOnWorkOrderToTechnician,
  openWorkOrderForControlCenter,
  unassignAllActiveJobsOnWorkOrder,
} from "@/lib/services/jobs";

function actionError(error: unknown): string {
  const message = error instanceof Error ? error.message : "UNKNOWN";
  switch (message) {
    case "FORBIDDEN":
      return "You do not have permission to do that.";
    case "FOREIGN_LOCATION":
      return "That work order is at another location.";
    case "WORK_ORDER_NOT_FOUND":
    case "JOB_NOT_FOUND":
      return "Work order not found.";
    case "WORK_ORDER_LOCKED":
      return "That work order is locked.";
    case "TECHNICIAN_NOT_FOUND":
      return "Technician not found.";
    case "OPENED_AT_UNAVAILABLE":
      return "Open timer is not available until the database migration is applied.";
    default:
      return "Something went wrong. Try again.";
  }
}

export async function dispatchWorkOrderToTechnicianAction(
  workOrderId: string,
  technicianId: string
): Promise<{ error: string | null }> {
  try {
    await assignAllActiveJobsOnWorkOrderToTechnician(workOrderId, technicianId);
    revalidatePath("/control-center");
    revalidatePath("/technician");
    revalidatePath("/technician/docket");
    revalidatePath("/dashboard");
    return { error: null };
  } catch (error) {
    return { error: actionError(error) };
  }
}

export async function unassignWorkOrderJobsAction(
  workOrderId: string
): Promise<{ error: string | null }> {
  try {
    await unassignAllActiveJobsOnWorkOrder(workOrderId);
    revalidatePath("/control-center");
    revalidatePath("/technician");
    revalidatePath("/technician/docket");
    revalidatePath("/dashboard");
    return { error: null };
  } catch (error) {
    return { error: actionError(error) };
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
    return { error: actionError(error) };
  }
}
